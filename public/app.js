// Questo file contiene la logica della UI e del networking WebRTC lato client.
// Architettura in breve:
// - Socket.IO: canale di signaling per scambio di offer/answer/ICE via server
// - RTCPeerConnection: crea connessioni P2P tra browser
// - RTCDataChannel: veicola i messaggi di chat direttamente tra peer
class WebRTCChat {
  constructor() {
    // Connessione Socket.IO al server di signaling
    this.socket = null;
    // Mappa delle connessioni per peer che associa userId → RTCPeerConnection
    this.peerConnections = new Map(); // Map<userId, RTCPeerConnection>
    // DataChannel creato quando siamo offerer (aka il primo peer che inizia la negoziazione)
    this.dataChannel = null;
    // ID della stanza a cui l'utente è attualmente connesso
    this.currentRoom = null;
    // Stato logico della UI (abilitazioni e badge di stato)
    this.isConnected = false;
    // Inizializza riferimenti agli elementi UI
    this.initializeElements();
    // Imposta gli event listener per i pulsanti e input
    this.setupEventListeners();
  }

  // Raccoglie e memorizza i riferimenti agli elementi del DOM (html) utilizzati dall'app
  initializeElements() {
    // Input per inserire l'ID stanza
    this.roomIdInput = document.getElementById("roomId");
    // Pulsante per unirsi alla stanza
    this.joinRoomBtn = document.getElementById("joinRoom");
    // Elemento che mostra lo stato della connessione
    this.connectionStatus = document.getElementById("connectionStatus");
    // Contenitore della chat
    this.chatContainer = document.getElementById("chatContainer");
    // Span che mostra la stanza corrente
    this.currentRoomSpan = document.getElementById("currentRoom");
    // Span che mostra il numero di peer connessi
    this.peerCountSpan = document.getElementById("peerCount");
    // Contenitore dei messaggi della chat
    this.messagesContainer = document.getElementById("messagesContainer");
    // Campo input per scrivere i messaggi
    this.messageInput = document.getElementById("messageInput");
    // Pulsante per inviare un messaggio
    this.sendMessageBtn = document.getElementById("sendMessage");
  }

  // Collega gli handler agli eventi UI (click/keypress) per controllare l'app
  setupEventListeners() {
    // Clic su "Unisciti" → joinRoom()
    this.joinRoomBtn.addEventListener("click", () => this.joinRoom());
    // Clic su "Invia" → sendMessage()
    this.sendMessageBtn.addEventListener("click", () => this.sendMessage());

    // Invio messaggio con tasto Invio
    this.messageInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter") {
        this.sendMessage();
      }
    });

    // Join stanza con tasto Invio
    this.roomIdInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter") {
        this.joinRoom();
      }
    });
  }

  // Avvia la connessione al server di signaling e si unisce a una stanza
  async joinRoom() {
    // Recupera l'ID della stanza dall'input inserito dall'utente
    const roomId = this.roomIdInput.value.trim();
    if (!roomId) {
      alert("Inserisci un ID stanza valido");
      return;
    }

    // Aggiorna stato connessione a "in corso"
    this.updateStatus("connecting", "Connessione in corso...");
    this.joinRoomBtn.disabled = true;

    try {
      // Crea la connessione Socket.IO al server di signaling
      this.socket = io();
      this.currentRoom = roomId;

      // Registra i listener per i vari eventi di signaling da socket.io
      this.setupSocketEvents();

      // Richiede al server di unirsi alla stanza specificata
      this.socket.emit("join-room", roomId);
      console.log("[joinRoom] Emesso evento join-room per stanza:", roomId);
    } catch (error) {
      console.error("Errore durante la connessione:", error);
      this.updateStatus("disconnected", "Errore di connessione");
      this.joinRoomBtn.disabled = false;
    }
  }

  //   DAVIDE RIPRENDI DA QUI

  // Registra tutti i listener per gli eventi Socket.IO ricevuti dal server
  setupSocketEvents() {
    this.socket.on("connect", () => {
      console.log("[socket] Connesso al server di signaling, socketId:", this.socket.id);
      this.updateStatus("connected", "Connesso al server di signaling");
    });

    this.socket.on("user-joined", (userId) => {
      // Un nuovo peer è entrato nella stanza: creiamo una connessione verso di lui
      console.log("[socket] Nuovo utente connesso alla stanza:", userId, "→ ruolo: answerer (attendo offer)");
      // Gli utenti già presenti non iniziano: aspettano l'offer e useranno ondatachannel
      this.createPeerConnection(userId, false);
      // Aggiorna il conteggio stimato (potrebbe essere 1 mentre si negozia)
      this.updatePeerCount();
    });

    this.socket.on("user-left", (userId) => {
      console.log("[socket] Utente uscito dalla stanza:", userId);
      this.removePeerConnection(userId);
      this.updatePeerCount();
    });

    this.socket.on("users-in-room", (users) => {
      // All'ingresso riceviamo la lista dei peer già presenti e iniziamo la connessione
      console.log("[socket] Utenti già presenti nella stanza:", users);
      // Il client che entra ORA è l'iniziatore verso ognuno degli utenti esistenti
      users.forEach((userId) => this.createPeerConnection(userId, true));
      this.updatePeerCount();

      // Mostra la chat non appena ci si unisce alla stanza
      this.showChatInterface();
    });

    this.socket.on("offer", async (data) => {
      // Ricezione di una SDP offer: prepariamo e inviamo la relativa answer
      console.log("[socket] Offer ricevuta da:", data.sender);
      await this.handleOffer(data.offer, data.sender);
    });

    this.socket.on("answer", async (data) => {
      // Ricezione di una SDP answer: completiamo la negoziazione
      console.log("[socket] Answer ricevuta da:", data.sender);
      await this.handleAnswer(data.answer, data.sender);
    });

    this.socket.on("ice-candidate", async (data) => {
      // Ricezione di un ICE candidate da aggiungere alla RTCPeerConnection
      console.log("[socket] ICE candidate ricevuto da:", data.sender);
      await this.handleIceCandidate(data.candidate, data.sender);
    });

    this.socket.on("disconnect", () => {
      console.log("[socket] Disconnesso dal server di signaling");
      this.updateStatus("disconnected", "Disconnesso dal server");
      this.isConnected = false;
      this.joinRoomBtn.disabled = false;
    });
  }

  // Crea una RTCPeerConnection verso lo userId, gestisce DataChannel e ICE
  async createPeerConnection(userId, isInitiator = false) {
    if (this.peerConnections.has(userId)) {
      console.log("[pc] Connessione già esistente con", userId);
      return;
    }

    console.log("[pc] Creo nuova RTCPeerConnection verso", userId);
    const peerConnection = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
      ],
    }); // Server STUN pubblici per la scoperta del percorso di rete (NAT traversal)

    // Crea un DataChannel per questo peer SOLO se siamo l'iniziatore di questa connessione
    let dataChannel = null;
    if (isInitiator) {
      console.log("[pc] Iniziatore: creo DataChannel verso", userId);
      dataChannel = peerConnection.createDataChannel("messages", {
        ordered: true, // Garantisce l'ordine di consegna dei messaggi
      });
      this.setupDataChannel(dataChannel, userId);
    }

    // Ogni ICE candidate scoperto viene inviato al peer tramite il server di signaling
    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        console.log("[pc] ICE candidate locale → invio a", userId);
        this.socket.emit("ice-candidate", {
          target: userId,
          candidate: event.candidate,
        });
      }
    };

    // Quando siamo answerer, riceveremo un DataChannel in arrivo da configurare
    peerConnection.ondatachannel = (event) => {
      const incomingDataChannel = event.channel;
      console.log("[pc] DataChannel ricevuto da", userId, "stato:", incomingDataChannel.readyState);
      this.setupDataChannel(incomingDataChannel, userId);
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
        this.updateStatus("connected", "Connesso");
        this.isConnected = true;
        this.updatePeerCount();
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
        this.updateStatus("connected", "Connessione P2P stabilita");
        this.isConnected = true;
      }
    };

    // Conserviamo un riferimento al DataChannel dentro l'oggetto peerConnection
    peerConnection.dataChannel = dataChannel;
    this.peerConnections.set(userId, peerConnection);

    // Se siamo iniziatori (abbiamo creato il DataChannel), generiamo e inviamo la SDP offer
    if (isInitiator && dataChannel) {
      try {
        console.log("[pc] Iniziatore: creo e invio offer a", userId);
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);

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
  setupDataChannel(dataChannel, userId) {
    dataChannel.onopen = () => {
      console.log(`[dc] DataChannel aperto con ${userId} (stato: ${dataChannel.readyState})`);
      this.updateStatus(
        "connected",
        `Connesso - DataChannel con ${userId.substring(0, 8)} aperto`
      );
    };

    dataChannel.onmessage = (event) => {
      // I messaggi arrivano come stringhe: li interpretiamo come JSON e mostriamo il contenuto
      try {
        const message = JSON.parse(event.data);
        console.log(`[dc] Messaggio RICEVUTO da ${userId}:`, message);
        this.displayMessage(
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
  async handleOffer(offer, sender) {
    console.log(`[signaling] Ricevuto offer da ${sender}`);
    const peerConnection = this.peerConnections.get(sender);
    if (!peerConnection) {
      await this.createPeerConnection(sender);
      const newPeerConnection = this.peerConnections.get(sender);
      await newPeerConnection.setRemoteDescription(offer);

      const answer = await newPeerConnection.createAnswer();
      await newPeerConnection.setLocalDescription(answer);

      this.socket.emit("answer", {
        target: sender,
        answer: answer,
      });
      console.log(`[signaling] Answer inviata a ${sender}`);
    } else {
      await peerConnection.setRemoteDescription(offer);

      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);

      this.socket.emit("answer", {
        target: sender,
        answer: answer,
      });
      console.log(`[signaling] Answer inviata a ${sender}`);
    }
  }

  // Gestisce una SDP answer ricevuta: completa la negoziazione lato offerer
  async handleAnswer(answer, sender) {
    console.log(`[signaling] Ricevuto answer da ${sender}`);
    const peerConnection = this.peerConnections.get(sender);
    if (peerConnection) {
      await peerConnection.setRemoteDescription(answer);
      console.log(`[signaling] Answer processata da ${sender}`);
    }
  }

  // Aggiunge alla connessione il candidate ICE ricevuto dal peer specificato
  async handleIceCandidate(candidate, sender) {
    console.log(`[signaling] Ricevuto ICE candidate da ${sender}`);
    const peerConnection = this.peerConnections.get(sender);
    if (peerConnection) {
      await peerConnection.addIceCandidate(candidate);
      console.log(`[signaling] ICE candidate aggiunto da ${sender}`);
    }
  }

  // Chiude e rimuove la connessione verso un peer, aggiornando il conteggio
  removePeerConnection(userId) {
    const peerConnection = this.peerConnections.get(userId);
    if (peerConnection) {
      peerConnection.close();
      this.peerConnections.delete(userId);
      console.log("[pc] Connessione rimossa con", userId);
      this.updatePeerCount();
    }
  }

  // Invia il messaggio scritto nella casella a tutti i peer connessi via DataChannel
  sendMessage() {
    const message = this.messageInput.value.trim();
    if (!message || !this.isConnected) {
      if (!message) {
        console.log("[chat] Messaggio vuoto, non invio");
      }
      if (!this.isConnected) {
        console.log("[chat] Non connesso, impossibile inviare");
      }
      return;
    }

    // Invia il messaggio a tutti i peer connessi
    const messageData = {
      content: message,
      sender: this.socket.id,
      timestamp: new Date().toISOString(),
    };

    console.log("[chat] INVIO messaggio:", messageData);
    console.log(
      "[chat] Stato connessioni:",
      Array.from(this.peerConnections.entries()).map(([id, pc]) => ({
        id,
        connectionState: pc.connectionState,
        dataChannelState: pc.dataChannel?.readyState,
      }))
    );

    let messageSent = false;
    this.peerConnections.forEach((peerConnection, userId) => {
      if (peerConnection.connectionState === "connected") {
        const dataChannel = peerConnection.dataChannel;

        if (dataChannel && dataChannel.readyState === "open") {
          dataChannel.send(JSON.stringify(messageData));
          messageSent = true;
          console.log(`[chat] Messaggio inviato a ${userId}`);
        } else {
          console.log("[chat] DataChannel non disponibile per", userId, "stato:", dataChannel?.readyState);
        }
      } else {
        console.log("[chat] Peer non connesso", userId, "stato:", peerConnection.connectionState);
      }
    });

    // Mostra il messaggio nella nostra chat (mittente)
    this.displayMessage(message, "Tu", true);
    this.messageInput.value = "";

    // Se non ci sono peer connessi, mostra un messaggio informativo
    if (!messageSent && this.peerConnections.size === 0) {
      this.displayMessage(
        "Nessun peer connesso. Il messaggio è stato salvato localmente.",
        "Sistema",
        false
      );
    }
  }

  // Crea il blocco visuale del messaggio e lo aggiunge alla lista
  displayMessage(content, sender, isOwn) {
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

    this.messagesContainer.appendChild(messageDiv); // Inserisce il messaggio in fondo
    this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
  }

  // Aggiorna il badge di stato (connected/connecting/disconnected)
  updateStatus(status, text) {
    this.connectionStatus.className = `status ${status}`;
    this.connectionStatus.textContent = text;
  }

  // Aggiorna il numero di peer attualmente connessi
  updatePeerCount() {
    this.peerCountSpan.textContent = this.peerConnections.size;
  }

  // Rende visibile l'interfaccia chat ed imposta lo stato iniziale
  showChatInterface() {
    this.chatContainer.style.display = "block";
    this.currentRoomSpan.textContent = this.currentRoom;
    this.updateStatus(
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

// Inizializza l'app quando il DOM è caricato
document.addEventListener("DOMContentLoaded", () => {
  new WebRTCChat();
});
