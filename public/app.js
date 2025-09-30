// Questo file contiene la logica della UI e del networking WebRTC lato client.
// Architettura in breve:
// - Socket.IO: canale di signaling per scambio di offer/answer/ICE via server
// - RTCPeerConnection: crea connessioni P2P tra browser
// - RTCDataChannel: veicola i messaggi di chat direttamente tra peer (è il canale di chat diretto)
class WebRTCChat {
  constructor() {
    // Connessione di Socket.IO al server di signaling (server.js)
    this.socket = null;
    // Mappa delle connessioni per peer che associa userId → RTCPeerConnection, serve per varie operazioni in cui dobbiamo sapere in quale room stanno gli user
    this.connessioniPeer = new Map(); 
    // DataChannel per lo scambio di messaggi tra i perr, creato quando siamo offerer (aka il primo peer che inizia la negoziazione)
    this.dataChannel = null;
    // ID della stanza a cui l'utente è attualmente connesso
    this.stanzaCorrente = null;
    // Stato logico della UI (serve per abilitazioni e badge di stato)
    this.isConnected = false;
    // Inizializza riferimenti agli elementi UI
    this.inizializzaElementiUI();
    // Imposta gli event listener per i pulsanti e input
    this.impostaEventListeners();
  }

  // Raccoglie e memorizza i riferimenti agli elementi del DOM (html) utilizzati dall'app
  inizializzaElementiUI() {
    // Input per inserire l'ID stanza
    this.inputIdStanza = document.getElementById("roomId");
    // Pulsante per unirsi alla stanza
    this.bottoneEntraStanza = document.getElementById("joinRoom");
    // Elemento che mostra lo stato della connessione
    this.statoConnessione = document.getElementById("connectionStatus");
    // Contenitore della chat
    this.contenitoreChat = document.getElementById("chatContainer");
    // Span che mostra la stanza corrente
    this.spanStanzaCorrente = document.getElementById("currentRoom");
    // Span che mostra il numero di peer connessi
    this.spanConteggioPeer = document.getElementById("peerCount");
    // Contenitore dei messaggi della chat
    this.contenitoreMessaggi = document.getElementById("messagesContainer");
    // Campo input per scrivere i messaggi
    this.inputMessaggio = document.getElementById("messageInput");
    // Pulsante per inviare un messaggio
    this.bottoneInviaMessaggio = document.getElementById("sendMessage");
  }

  // Collega gli handler agli eventi UI (click/keypress) per controllare l'app
  impostaEventListeners() {
    // Clic su "Unisciti" → joinRoom()
    this.bottoneEntraStanza.addEventListener("click", () =>
      this.entraInStanza()
    );
    // Clic su "Invia" → sendMessage()
    this.bottoneInviaMessaggio.addEventListener("click", () =>
      this.inviaMessaggio()
    );

    // Invio messaggio con tasto Invio
    this.inputMessaggio.addEventListener("keypress", (e) => {
      if (e.key === "Enter") {
        this.inviaMessaggio();
      }
    });

    // Join stanza con tasto Invio
    this.inputIdStanza.addEventListener("keypress", (e) => {
      if (e.key === "Enter") {
        this.entraInStanza();
      }
    });
  }

  // DA QUI IN POI ci sono tutte le funzioni logiche della nostra app (entrare in una room, collegarsi ai peer, disconnettersi, etc)

  // Avvia la connessione al server di signaling e si unisce a una stanza
  async entraInStanza() {
    // Recupera l'ID della stanza dall'input inserito dall'utente
    const roomId = this.inputIdStanza.value.trim();
    if (!roomId) {
      alert("Inserisci un ID stanza valido");
      return;
    }

    // Aggiorna stato connessione a "in corso"
    this.aggiornaStato("connecting", "Connessione in corso...");
    this.bottoneEntraStanza.disabled = true;

    try {
      // @IMPORTANTE: Crea la connessione Socket.IO al server di signaling
      this.socket = io(); // funzione di libreria socket.IO che crea l'oggetto di tipo socket 
      // una volta istanziato in questo modo si collegherà al server della nostra applicazione
      this.stanzaCorrente = roomId;

      // Registra i listener per i vari eventi di signaling da socket.io
      this.impostaEventiSocket(); // dentro questa funzione avviene la logica principale!
      // qui dentro vengono attivati tutti gli event listener e l'app resta in attesa di questi eventi
      // questi eventi verranno emessi dal nostro server.js e il "cosa succede" è descritto nella funzione qua sotto!

      // Richiede al server di unirsi alla stanza specificata emettendo un evento join room che poi viene catturato da server.js
      this.socket.emit("join-room", roomId); // questo è un evento che triggera il nostro server.js
      console.log("[joinRoom] Emesso evento join-room per stanza:", roomId);
    } catch (error) {
      console.error("Errore durante la connessione:", error);
      this.aggiornaStato("disconnected", "Errore di connessione");
      this.bottoneEntraStanza.disabled = false;
    }
  }

  // Registra tutti i listener per gli eventi Socket.IO ricevuti dal server
  // dentro questa funzione ho vari eventi che quando attivati triggerano le funzioni che ho richiamato dentro essi
  // la definizione di cosa fanno queste funzioni è tutta piu in basso in questo file!
  impostaEventiSocket() {
    // Evento: connessione al server socket, questo evento è emesso automaticamente da socket.IO quando
    // la connessione con il nostro server.js va a buon fine! 
    this.socket.on("connect", () => {
      console.log(
        "[socket] Connesso al server di signaling, socketId: ",
        this.socket.id
      );
      this.aggiornaStato("connected", "Connesso al server di signaling");
    });

    // Evento: nuovo utente entrato nella stanza
    this.socket.on("user-joined", (userId) => {
      // Un nuovo peer è entrato nella stanza: creiamo una connessione verso di lui
      console.log(
        "[socket] Nuovo utente connesso alla stanza:",
        userId,
        "→ ruolo: answerer (attendo offer)"
      );
      // Gli utenti già presenti non iniziano: aspettano l'offer e useranno ondatachannel
      this.creaConnessionePeer(userId, false);
      // Aggiorna il conteggio stimato (potrebbe essere 1 mentre si negozia)
      this.aggiornaConteggioPeer();
    });

    // Evento: utente uscito dalla stanza
    this.socket.on("user-left", (userId) => {
      console.log("[socket] Utente uscito dalla stanza:", userId);
      this.rimuoviConnessionePeer(userId);
      this.aggiornaConteggioPeer();
    });

    // Evento: ci sono degli utenti già presenti nella stanza
    this.socket.on("users-in-room", (users) => {
      // All'ingresso riceviamo la lista dei peer già presenti e iniziamo la connessione
      console.log("[socket] Utenti già presenti nella stanza:", users);
      // Il client che entra ORA è l'iniziatore verso ognuno degli utenti esistenti
      users.forEach((userId) => this.creaConnessionePeer(userId, true));
      this.aggiornaConteggioPeer();

      // Mostra la chat non appena ci si unisce alla stanza
      this.mostraInterfacciaChat();
    });

    // Ricezione di una WebRTC offer
    this.socket.on("offer", async (data) => {
      // Ricezione di una SDP offer: prepariamo e inviamo la relativa answer
      console.log("[socket] Offer ricevuta da:", data.sender);
      await this.gestisciOffertaSDP(data.offer, data.sender);
    });

    // Ricezione di una WebRTC answer
    this.socket.on("answer", async (data) => {
      // Ricezione di una SDP answer: completiamo la negoziazione
      console.log("[socket] Answer ricevuta da:", data.sender);
      await this.gestisciRispostaSDP(data.answer, data.sender);
    });

    // Ricezione di un ICE candidate
    this.socket.on("ice-candidate", async (data) => {
      // Ricezione di un ICE candidate da aggiungere alla RTCPeerConnection
      console.log("[socket] ICE candidate ricevuto da:", data.sender);
      await this.gestisciCandidatoICE(data.candidate, data.sender);
    });

    // Evento: disconnessione dal server
    this.socket.on("disconnect", () => {
      console.log("[socket] Disconnesso dal server di signaling");
      this.aggiornaStato("disconnected", "Disconnesso dal server");
      this.isConnected = false;
      this.bottoneEntraStanza.disabled = false;
    });
  }

  // Crea una RTCPeerConnection verso lo userId, gestisce DataChannel e ICE
  async creaConnessionePeer(userId, isInitiator = false) {
    // check per verificare che non sei gia collegato a questo user della stanza
    if (this.connessioniPeer.has(userId)) {
      console.log("[pc] Connessione già esistente con", userId);
      return; // lo skippo perche sono già connesso con lui
    }

    // Crea una nuova connessione WebRTC con server STUN pubblici
    console.log("[pc] Creo nuova RTCPeerConnection verso", userId);
    const peerConnection = new RTCPeerConnection({
      iceServers: [
        // Server STUN pubblici per la scoperta del percorso di rete (NAT traversal)
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
      ],
    });

    // Crea un DataChannel per questo peer SOLO se siamo l'iniziatore di questa connessione
    let dataChannel = null;
    if (isInitiator) {
      console.log("[pc] Iniziatore: creo DataChannel verso ", userId);
      // adesso ho creato il mio datachannel per lo scambio di messaggi tra i due peer
      dataChannel = peerConnection.createDataChannel("messages", {
        // funzione di libreria
        ordered: true, // Garantisce l'ordine di consegna dei messaggi
      });
      // qui faccio il setup di questo dataChannel (vedi in basso la funzione cosa fa)
      this.impostaDataChannel(dataChannel, userId);
    }

    // Ogni ICE candidate scoperto viene inviato al peer tramite il server di signaling
    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        // sono tutte proprietà dell'oggetto che prendo dalle librerie...
        console.log("[pc] ICE candidate locale → invio a", userId);
        // emetto l'evento che viene captato da server.js
        this.socket.emit("ice-candidate", {
          target: userId,
          candidate: event.candidate,
        });
      }
    };

    // Quando siamo answerer, riceveremo un DataChannel in arrivo da configurare
    peerConnection.ondatachannel = (event) => {
      const incomingDataChannel = event.channel;
      console.log(
        "[pc] DataChannel ricevuto da",
        userId,
        "stato:",
        incomingDataChannel.readyState
      );
      // una volta ricevuto faccio anche qui il setup del canale di chat
      this.impostaDataChannel(incomingDataChannel, userId);
      // FONDAMENTALE: salva il riferimento per l'invio dei messaggi lato answerer
      peerConnection.dataChannel = incomingDataChannel;
    };

    // Aggiorna lo stato quando la connessione P2P viene stabilita
    peerConnection.onconnectionstatechange = () => {
      console.log(
        `[pc] Stato connessione con ${userId}:`,
        peerConnection.connectionState
      );
      if (peerConnection.connectionState === "connected") {
        this.aggiornaStato("connected", "Connesso");
        this.isConnected = true;
        this.aggiornaConteggioPeer();
      }
    };

    // Log dello stato ICE per diagnosticare connessione P2P
    peerConnection.oniceconnectionstatechange = () => {
      console.log(
        `[pc] ICE state con ${userId}:`,
        peerConnection.iceConnectionState
      );
      if (
        peerConnection.iceConnectionState === "connected" ||
        peerConnection.iceConnectionState === "completed"
      ) {
        this.aggiornaStato("connected", "Connessione P2P stabilita");
        this.isConnected = true;
      }
    };

    // Conserviamo un riferimento al DataChannel dentro l'oggetto peerConnection
    peerConnection.dataChannel = dataChannel;
    this.connessioniPeer.set(userId, peerConnection);

    // Se siamo iniziatori (abbiamo creato il DataChannel), generiamo e inviamo la SDP offer
    // qui avviene il flusso di lavoro principale
    if (isInitiator && dataChannel) {
      try {
        console.log("[pc] Iniziatore: creo e invio offer a", userId);
        const offer = await peerConnection.createOffer(); // funzioni di libreria
        await peerConnection.setLocalDescription(offer); // funzioni di libreria

        this.socket.emit("offer", {
          target: userId,
          offer: offer,
        });
        console.log(`[pc] Offer inviata a ${userId}`);
      } catch (error) {
        console.error("[pc] Errore nella creazione dell'offer:", error);
      }
    }
  }

  // Configura gli handler del DataChannel per inviare/ricevere messaggi
  impostaDataChannel(dataChannel, userId) {
    dataChannel.onopen = () => {
      console.log(
        `[dc] DataChannel aperto con ${userId} (stato: ${dataChannel.readyState})`
      );
      this.aggiornaStato(
        "connected",
        `Connesso - DataChannel con ${userId.substring(0, 8)} aperto`
      );
    };

    dataChannel.onmessage = (event) => {
      // I messaggi arrivano come stringhe: li interpretiamo come JSON e mostriamo il contenuto
      try {
        const message = JSON.parse(event.data);
        console.log(`[dc] Messaggio RICEVUTO da ${userId}:`, message);
        this.mostraMessaggio(
          message.content,
          `Peer ${userId.substring(0, 8)}`,
          false
        );
      } catch (error) {
        console.error("Errore nel parsing del messaggio:", error);
      }
    };

    dataChannel.onerror = (error) => {
      console.error("[dc] Errore nel DataChannel:", error);
    };

    dataChannel.onclose = () => {
      console.log(`[dc] DataChannel chiuso con ${userId}`);
    };
  }

  // Gestisce una SDP offer ricevuta: imposta la remote, crea e invia una answer
  async gestisciOffertaSDP(offer, sender) {
    // Log in console: abbiamo ricevuto un'offerta SDP da un altro peer
    console.log(`[signaling] Ricevuto offer da ${sender}`);

    // Recupera la connessione WebRTC già esistente (se presente) con quel peer
    const peerConnection = this.connessioniPeer.get(sender);

    if (!peerConnection) {
      // Se NON esiste ancora una connessione con questo peer:
      // 1. Creiamo una nuova RTCPeerConnection
      await this.creaConnessionePeer(sender);

      // 2. Recuperiamo la connessione appena creata dalla mappa
      const newPeerConnection = this.connessioniPeer.get(sender);

      // 3. Impostiamo la descrizione remota con l'offerta ricevuta (SDP offer)
      await newPeerConnection.setRemoteDescription(offer);

      // 4. Creiamo una risposta (SDP answer)
      const answer = await newPeerConnection.createAnswer();

      // 5. Impostiamo la descrizione locale con la risposta
      await newPeerConnection.setLocalDescription(answer);

      // 6. Inviamo l'answer al peer mittente tramite il server di signaling
      this.socket.emit("answer", {
        target: sender, // a chi deve arrivare
        answer: answer, // contenuto SDP
      });

      console.log(`[signaling] Answer inviata a ${sender}`);
    } else {
      // Se esiste già una connessione con questo peer:
      // 1. Aggiorniamo la descrizione remota con l'offer ricevuta
      await peerConnection.setRemoteDescription(offer);

      // 2. Creiamo una risposta (answer) alla sua offerta
      const answer = await peerConnection.createAnswer();

      // 3. Impostiamo la nostra descrizione locale con la risposta
      await peerConnection.setLocalDescription(answer);

      // 4. Inviamo la risposta al peer tramite il server di signaling
      this.socket.emit("answer", {
        target: sender,
        answer: answer,
      });

      console.log(`[signaling] Answer inviata a ${sender}`);
    }
  }

  // Gestisce una SDP answer ricevuta: completa la negoziazione lato offerer
  async gestisciRispostaSDP(answer, sender) {
    // Log: abbiamo ricevuto una risposta SDP (answer) da un peer
    console.log(`[signaling] Ricevuto answer da ${sender}`);

    // Recupera la connessione WebRTC associata a quel peer
    const peerConnection = this.connessioniPeer.get(sender);

    if (peerConnection) {
      // Imposta la descrizione remota con l'answer ricevuta
      // → questo completa la fase di negoziazione SDP lato "offerer"
      await peerConnection.setRemoteDescription(answer);

      console.log(`[signaling] Answer processata da ${sender}`);
    }
  }

  // Aggiunge alla connessione il candidate ICE ricevuto dal peer specificato
  async gestisciCandidatoICE(candidate, sender) {
    // Log: abbiamo ricevuto un ICE candidate
    console.log(`[signaling] Ricevuto ICE candidate da ${sender}`);

    // Recupera la connessione WebRTC verso quel peer
    const peerConnection = this.connessioniPeer.get(sender);

    if (peerConnection) {
      // Aggiunge l'ICE candidate alla connessione
      // → serve per informare il browser su come raggiungere l’altro peer (indirizzi, protocolli, porte)
      await peerConnection.addIceCandidate(candidate);

      console.log(`[signaling] ICE candidate aggiunto da ${sender}`);
    }
  }

  // Chiude e rimuove la connessione verso un peer, aggiornando il conteggio
  rimuoviConnessionePeer(userId) {
    const peerConnection = this.connessioniPeer.get(userId);
    if (peerConnection) {
      peerConnection.close();
      this.connessioniPeer.delete(userId);
      console.log("[pc] Connessione rimossa con", userId);
      this.aggiornaConteggioPeer();
    }
  }

  // Invia il messaggio scritto nella casella a tutti i peer connessi via DataChannel
  inviaMessaggio() {
    // Recupera il testo scritto dall’utente e rimuove eventuali spazi iniziali/finali
    const message = this.inputMessaggio.value.trim();

    // Controlla subito se il messaggio è vuoto o se non sei connesso
    if (!message || !this.isConnected) {
      if (!message) {
        console.log("[chat] Messaggio vuoto, non invio");
      }
      if (!this.isConnected) {
        console.log("[chat] Non connesso, impossibile inviare");
      }
      return; // Esce dalla funzione senza fare nulla
    }

    // Costruisce l’oggetto messaggio con testo, id del mittente e timestamp
    const messageData = {
      content: message,
      sender: this.socket.id, // id univoco del client
      timestamp: new Date().toISOString(), // data e ora in formato ISO
    };

    // Log utile per debug: cosa stai inviando e stato delle connessioni
    console.log("[chat] INVIO messaggio:", messageData);
    console.log(
      "[chat] Stato connessioni:",
      Array.from(this.connessioniPeer.entries()).map(([id, pc]) => ({
        id,
        connectionState: pc.connectionState,
        dataChannelState: pc.dataChannel?.readyState,
      }))
    );

    let messageSent = false;

    // Cicla su tutte le connessioni WebRTC attive con i peer
    this.connessioniPeer.forEach((peerConnection, userId) => {
      // Considera solo peer effettivamente connessi
      if (peerConnection.connectionState === "connected") {
        const dataChannel = peerConnection.dataChannel;

        // Se il DataChannel è aperto → invia il messaggio serializzato in JSON
        if (dataChannel && dataChannel.readyState === "open") {
          dataChannel.send(JSON.stringify(messageData));
          messageSent = true;
          console.log(`[chat] Messaggio inviato a ${userId}`);
        } else {
          // Se il DataChannel non è pronto, logga il problema
          console.log(
            "[chat] DataChannel non disponibile per",
            userId,
            "stato:",
            dataChannel?.readyState
          );
        }
      } else {
        // Se il peer non è connesso, logga lo stato
        console.log(
          "[chat] Peer non connesso",
          userId,
          "stato:",
          peerConnection.connectionState
        );
      }
    });

    // Mostra subito il messaggio nella tua interfaccia locale (mittente = Tu)
    this.mostraMessaggio(message, "Tu", true);
    // Pulisce il campo input
    this.inputMessaggio.value = "";

    // Se non è stato inviato a nessuno e non hai peer → avviso del sistema
    if (!messageSent && this.connessioniPeer.size === 0) {
      this.mostraMessaggio(
        "Nessun peer connesso. Il messaggio è stato salvato localmente.",
        "Sistema",
        false
      );
    }
  }

  // Crea il blocco visuale del messaggio e lo aggiunge alla lista
  mostraMessaggio(content, sender, isOwn) {
    const messageDiv = document.createElement("div");

    // Determina la classe CSS in base al tipo di messaggio
    if (sender === "Sistema") {
      messageDiv.className = "message system";
    } else {
      messageDiv.className = `message ${isOwn ? "own" : "other"}`;
    }

    const timestamp = new Date().toLocaleTimeString();

    if (sender === "Sistema") {
      messageDiv.innerHTML = `
                <div class="message-content">${this.escapeHtml(content)}</div>
            `;
    } else {
      messageDiv.innerHTML = `
                <div class="message-header">${sender} - ${timestamp}</div>
                <div class="message-content">${this.escapeHtml(content)}</div>
            `;
    }

    this.contenitoreMessaggi.appendChild(messageDiv); // Inserisce il messaggio in fondo
    this.contenitoreMessaggi.scrollTop = this.contenitoreMessaggi.scrollHeight;
  }

  // Aggiorna il badge di stato (connected/connecting/disconnected)
  aggiornaStato(status, text) {
    this.statoConnessione.className = `status ${status}`;
    this.statoConnessione.textContent = text;
  }

  // Aggiorna il numero di peer attualmente connessi
  aggiornaConteggioPeer() {
    this.spanConteggioPeer.textContent = this.connessioniPeer.size;
  }

  // Rende visibile l'interfaccia chat ed imposta lo stato iniziale
  mostraInterfacciaChat() {
    this.contenitoreChat.style.display = "block";
    this.spanStanzaCorrente.textContent = this.stanzaCorrente;
    this.aggiornaStato(
      "connected",
      "Nella stanza - Aspettando connessioni peer..."
    );
    this.isConnected = true;
  }

  // Effettua escaping del testo per prevenire injection HTML nei messaggi
  escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }
}

// Inizializza l'app quando il DOM è caricato, questo è il punto di ingresso!!!
document.addEventListener("DOMContentLoaded", () => {
  new WebRTCChat();
});
