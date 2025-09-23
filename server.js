// Questo file definisce il SERVER di signaling per WebRTC usando Express e Socket.IO.
// Il "signaling" è la fase in cui i peer si scambiano informazioni (offer/answer/ICE)
// per potersi connettere direttamente tra loro. Qui non transitano i dati della chat.
// il server di signaling serve per eseguire la handshake tra i due peer
// così che possano iniziare a scambiarsi dati liberamente sul canale di chat diretto

// 1. IMPORTO LE LIBRERIE NECESSARIE
const express = require("express"); // per il server web
const http = require("http"); // per il server base
const socketIo = require("socket.io"); // per comunicazione in tempo reale
const cors = require("cors"); // per permettere richieste cross-origin
const path = require("path"); // per gestire percorsi dei file del tuo progetto

// 2. CREO L'INFRASTRUTTURA DEL SERVER
const app = express(); // crea un'istanza di Express, che è un framework Node.js per costruire server web. Gestisce le richieste HTTP (come servire file statici da /public, gestire route, ecc.).
const server = http.createServer(app); // crea un server HTTP standard usando il modulo http di Node.js, e gli passa l'app Express come gestore delle richieste. Questo server ascolta su una porta (3000 nel tuo caso) e risponde alle richieste web tradizionali.
const io = socketIo(server, {
  // Socket.IO è una libreria JavaScript che permette comunicazione bidirezionale in tempo reale tra il server e i client (browser). Funziona principalmente tramite WebSockets, un protocollo che mantiene una connessione aperta e persistente tra client e server, permettendo di inviare messaggi istantaneamente in entrambe le direzioni senza bisogno di richieste HTTP ripetute.
  cors: {
    // Viene configurata con CORS per accettare connessioni da qualsiasi origine. Questa istanza gestisce gli eventi di connessione WebSocket, come quando un client si unisce a una stanza (`join-room`), invia un'offerta WebRTC (`offer`), riceve una risposta (`answer`), o scambia candidati ICE (`ice-candidate`).
    origin: "*",
    methods: ["GET", "POST"],
  },
  // In sostanza, coordina il "signaling" necessario per stabilire connessioni peer-to-peer dirette tra i browser, senza che il server debba gestire il flusso di dati della chat vera e propria.
});

// Middleware
app.use(cors()); // Abilita CORS (Cross-Origin Resource Sharing). Questo permette al tuo server di accettare richieste HTTP da domini diversi dal tuo (ad esempio, se il client è su un altro sito). È necessario perché i browser bloccano richieste cross-origin per sicurezza, ma per app web in tempo reale spesso serve abilitarlo.
app.use(express.static(path.join(__dirname, "public"))); // Configura Express per servire automaticamente i file statici (come HTML, CSS, JavaScript) dalla cartella /public. Quando un browser visita il tuo sito (es. http://localhost:3000), Express automaticamente serve questi file quando un browser visita il tuo sito, senza bisogno di route specifiche. __dirname è il percorso della cartella corrente del file server.js.

// Crea una struttura dati chiamata Map per memorizzare le "stanze" di chat attive. Una Map è come un dizionario: la chiave è l'ID della stanza (roomId, una stringa come "room123"), e il valore è un Set (una collezione unica) di ID dei socket connessi (socketId, identificatori unici per ogni client connesso via Socket.IO). Questo serve per sapere quali utenti sono in quale stanza, facilitando l'invio di messaggi solo agli utenti della stessa stanza durante il signaling WebRTC.
const rooms = new Map(); // Map<roomId, Set<socketId>>

// Gestione connessioni Socket.IO: ogni client connesso ha un "socket"
// Questa parte del codice gestisce gli eventi di connessione e unione alle stanze tramite Socket.IO
// io.on è un listener di eventi di socketIo
// resta in attesa che un client (browser) si connetta al server via WebSocket
// questo succede quando apri una pagina web che usa socketIo che emette un evento chiamato "connection"
io.on("connection", (socket) => {
  // il parametro socket non lo inizializzi tu, viene creato e passato automaticamente da socketIo
  // ogni volta che un nuovo client si connette, rappresenta la connessione di quel client specifico
  // è un oggetto che contiene metodi per comunicare con quel client
  console.log("Nuovo client connesso:", socket.id); // ogni client ha il suo id unico generato automaticamente sempre da socketIo

  // Un utente vuole creare o unirsi a una stanza
  socket.on("join-room", (roomId) => {
    // il socket rimane in ascolto dell'evento "join-room", che è definito dentro app.js!!!
    socket.join(roomId); // Aggiunge il socket alla stanza logica gestita da Socket.IO
    // roomId è quello che inserisci tu nella chat quando ti connetti, viene preso dal frontend!

    // Inizializza la stanza se non esiste
    if (!rooms.has(roomId)) {
      // Controlli se la stanza roomId esiste già nella tua Map rooms.
      // Se non esiste, la crei inizializzandola con un nuovo Set vuoto.
      // Questo Set conterrà gli ID dei socket (utenti) connessi a quella stanza.
      rooms.set(roomId, new Set());
    }

    // Traccia il socket nella Map rooms
    rooms.get(roomId).add(socket.id);
    // Aggiungi l'ID del socket corrente (socket.id) al Set della stanza roomId.
    // Questo traccia che questo utente è ora nella stanza, aggiornando la tua struttura dati rooms

    console.log(`Client ${socket.id} si è unito alla stanza ${roomId}`);

    // Notifica agli altri client nella stanza con lo stesso roomId
    socket.to(roomId).emit("user-joined", socket.id);
    // questo non è un listener di socketIo ma emette un evento "user-joined"
    // che l'istanza di socketId presente nell'altro browser può intercettare!
    // Gli dici "un nuovo utente si è unito, ecco il suo ID socket".
    // I client (browser) che ascoltano questo evento (probabilmente in public/app.js) possono reagire,
    // ad esempio aggiornando l'interfaccia per mostrare il nuovo utente

    // Invia la lista degli utenti già presenti (escludendo il chiamante aka TU)
    const usersInRoom = Array.from(rooms.get(roomId)).filter(
      // converte la MAP di utenti della stanza in un array
      (id) => id !== socket.id // esclude l'utente corrente della lista perche nn serve dirgli che lui stesso è nella stanza lol
    );
    socket.emit("users-in-room", usersInRoom); // invia questa lista solo al client che si è appena unito
    // Gli dici "ecco gli altri utenti già presenti nella stanza, puoi iniziare il signaling con loro".

    // In sintesi, quando un utente si unisce a una stanza, aggiorni la struttura dati, logghi l'evento,
    // avvisi gli altri utenti esistenti del nuovo arrivo, e dai al nuovo utente la lista di chi c'è già.
    // Questo prepara tutto per il signaling WebRTC tra peer nella stessa stanza
  });

  // Forwarding dei messaggi di signaling WebRTC tra peer (solo signaling, non sono i msg di chat questi!!!)
  // Il server agisce come intermediario temporaneo per scambiare le informazioni necessarie
  // a stabilire una connessione diretta peer-to-peer
  // questi due listener intercettano i messaggi inviati dai client (browser) durante il processo di signaling
  socket.on("offer", (data) => {
    // quando ad esempio un peer vuole connettersi ad un altro peer invia una "offer" (proposta di connessione)
    socket.to(data.target).emit("offer", {
      // data.target è l'id del socket del peer a cui vuoi connetterti
      offer: data.offer, // data è un oggetto payload inviato automaticamente dal client assieme all'evento offer
      sender: socket.id, // tuo id
    });
  });

  // questo listener si attiva dopo che il peer destinatario ha ricevuto e processato la offer
  // risponde alla offer che gli è stata inviata mandandogli i suoi dati (ip/porta)
  socket.on("answer", (data) => {
    // qui viene emessa una risposta alla richiesta del primo peer che è il target
    socket.to(data.target).emit("answer", {
      answer: data.answer,
      sender: socket.id,
    });
  });

  // sia data che offer sono oggetti SDP creati dal browser usando le API webRTC
  // contengono le info tecniche per la connessione come indirizzo IP e porta dei peer!

  // ATTENZIONE! avrai notato che c'è un "buco di trama" tra l'invio della offer e l'invio della answer
  // il processo di ricezione ed elaborazione di una offer avviene sul lato client (sul browser non sul server quindi)
  // la logica di ricezione ed elaborazione sta in public/app.js
  // il server deve solo fare da tramite tra i due peer! va bene così!

  // qui stai gestendo l'inoltro dei caondidati ICE, che sono l'ultima parte necessaria per stabilire la connessione WebRTC
  // Cosa sono i candidati ICE:
  // Dopo lo scambio di offerta e risposta, i peer devono scambiarsi informazioni sui possibili percorsi di rete (indirizzi IP, porte, protocolli) per trovare il modo migliore di connettersi direttamente.
  // Ogni peer genera "candidati" (candidates) usando l'API WebRTC, che rappresentano opzioni come "usa il mio IP pubblico", "usa STUN/TURN server", ecc.
  // Questi candidati vengono scambiati finché entrambi i peer non trovano una combinazione compatibile per la connessione peer-to-peer.
  socket.on("ice-candidate", (data) => { // quando un client trova un possibile candidate lo invia all'altro peer (target)
    socket.to(data.target).emit("ice-candidate", {
      candidate: data.candidate, // i dati contengono dettagli tecnici come indirizzo, porta, tipo di candidate
      sender: socket.id,
      // Il server inoltra solo i candidati, come per offerta e risposta; la logica di generazione e processamento è sul client-side
    });
  });

  // Gestione disconnessione
  socket.on("disconnect", () => {
    console.log("Client disconnesso:", socket.id);

    // Rimuovi il client da tutte le stanze
    rooms.forEach((users, roomId) => {
      if (users.has(socket.id)) {
        users.delete(socket.id);
        socket.to(roomId).emit("user-left", socket.id); // Avvisa gli altri peer nella stanza

        // Se la stanza è vuota, rimuovila
        if (users.size === 0) {
          rooms.delete(roomId);
        }
      }
    });
  });
});

// questa è una funzione che lanci manualmente con 'npm start'
// avvia il server e lo mette in ascolto sulla porta 3000 (localhost)
// avvia il server HTTP che include socketIO dopo che hai configurato tutto
const PORT = process.env.PORT || 3000; // Porta di ascolto del server
server.listen(PORT, () => {
  console.log(`Server in ascolto sulla porta ${PORT}`);
  console.log(`Apri http://localhost:${PORT} nel browser`);
}); // Avvio server HTTP + Socket.IO

// la definizione di cosa deve fare 'npm start' sta dentro package.json
// `npm start` → esegue `node server.js` → il codice arriva a `server.listen()` → server si avvia.

