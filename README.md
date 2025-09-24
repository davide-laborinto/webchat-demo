# 🚀 WebRTC Chat Demo

Una demo di chat peer-to-peer che utilizza WebRTC per la comunicazione diretta tra browser, senza passare attraverso un server centrale per i messaggi.

## ✨ Caratteristiche

- **Comunicazione Peer-to-Peer**: I messaggi vengono inviati direttamente tra i browser usando WebRTC
- **Signaling Server**: Il server viene utilizzato solo per il coordinamento iniziale delle connessioni (handshake)
- **Interfaccia Moderna**: UI semplicistica per testare la chat tra due peer
- **Multi-room**: Supporto per stanze multiple con ID personalizzati
- **Tempo Reale**: Messaggi istantanei senza latenza del server

## 🛠️ Tecnologie Utilizzate

- **Frontend**: HTML5, CSS3, JavaScript ES6+
- **Backend**: Node.js, Express.js
- **WebRTC**: Per la comunicazione peer-to-peer
- **Socket.IO**: Per il signaling server
- **Data Channels**: Per l'invio dei messaggi

## 📦 Installazione

1. **Clona o scarica il progetto**
   ```bash
   cd webchat-demo
   ```

2. **Installa le dipendenze**
   ```bash
   npm install
   ```

3. **Avvia il server**
   ```bash
   npm start
   ```

4. **Apri il browser**
   ```
   http://localhost:3000
   ```

## 🚀 Come Usare

1. **Apri la prima finestra**: Vai su `http://localhost:3000`
2. **Inserisci un ID stanza**: Ad esempio "room1" o "demo"
3. **Clicca "Entra nella Stanza"**
4. **Apri una seconda finestra**: Apri un'altra tab/finestra con lo stesso URL
5. **Inserisci lo stesso ID stanza** e clicca "Entra nella Stanza"
6. **Inizia a chattare**: I messaggi verranno inviati direttamente tra i browser!

## 🔧 Come Funziona

### Architettura

```
Browser A ←→ WebRTC Data Channel ←→ Browser B
     ↓                                    ↓
     └────────── Signaling Server ────────┘
```

### Processo di Connessione

1. **Signaling**: I browser si connettono al server per coordinare la connessione WebRTC
2. **ICE Exchange**: Scambio di informazioni di rete per trovare il percorso migliore
3. **Data Channel**: Creazione di un canale dati per l'invio dei messaggi
4. **Comunicazione Diretta**: I messaggi vengono inviati direttamente tra i peer nel data channel

### Flusso dei Messaggi

1. Utente scrive un messaggio
2. Il messaggio viene inviato tramite Data Channel WebRTC
3. Il peer ricevente riceve il messaggio direttamente
4. Il messaggio viene visualizzato nell'interfaccia

## 📖 SPIEGAZIONE WEB RTC

Questa sezione fornisce una spiegazione completa e dettagliata del flusso WebRTC implementato nell'applicazione, coprendo sia la logica lato server che lato client. L'obiettivo è descrivere come due peer (browser) stabiliscono una connessione diretta e scambiano messaggi senza passare attraverso il server centrale.

### 1. Introduzione a WebRTC e Signaling

WebRTC (Web Real-Time Communication) è una tecnologia che permette la comunicazione peer-to-peer diretta tra browser senza bisogno di server intermedi per i dati. Tuttavia, per stabilire questa connessione diretta, è necessario un processo iniziale chiamato "signaling", dove i peer si scambiano informazioni tecniche (Session Description Protocol - SDP) e candidati di rete (ICE - Interactive Connectivity Establishment).

Nel nostro caso:
- **Signaling Server**: Gestito da `server.js` con Socket.IO, coordina lo scambio iniziale ma non vede mai i messaggi della chat.
- **Peer-to-Peer**: Una volta stabilita, la comunicazione avviene direttamente tra i browser via DataChannel.
- **STUN Servers**: Utilizzati per scoprire gli indirizzi IP pubblici e facilitare il NAT traversal.

### 2. Ruolo del Server di Signaling (`server.js`)

Il server non è coinvolto nella chat vera e propria, ma solo nella fase di handshake iniziale. Ecco come funziona:

#### Gestione delle Stanze
- Il server mantiene una `Map` chiamata `rooms`, dove ogni chiave è un `roomId` (es. "room1") e il valore è un `Set` di `socketId` (ID unici dei client connessi).
- Quando un client emette l'evento `"join-room"` con un `roomId`:
  - Il socket si unisce alla stanza logica di Socket.IO.
  - Viene aggiunto alla `Map` `rooms`.
  - Il server emette `"user-joined"` agli altri client nella stanza, passando il `socketId` del nuovo utente.
  - Invia al nuovo client l'evento `"users-in-room"` con la lista degli utenti già presenti (escludendo se stesso).

#### Scambio di Messaggi di Signaling
Il server inoltra tre tipi di messaggi tra i peer:
- **`"offer"`**: Quando un peer iniziatore vuole connettersi, invia una SDP offer contenente le sue capacità e configurazione.
- **`"answer"`**: Il peer destinatario risponde con una SDP answer contenente le sue informazioni.
- **`"ice-candidate"`**: Entrambi i peer scambiano candidati ICE (indirizzi IP, porte, protocolli) per trovare il percorso di connessione ottimale.

Il server usa `socket.to(data.target).emit()` per inoltrare questi messaggi solo al peer destinatario.

#### Gestione Disconnessioni
- Quando un client si disconnette, il server:
  - Lo rimuove da tutte le stanze nella `Map` `rooms`.
  - Emette `"user-left"` agli altri peer nella stanza.
  - Se una stanza rimane vuota, la elimina dalla `Map`.

### 3. Flusso Lato Client (`public/app.js`)

La classe `WebRTCChat` gestisce tutta la logica WebRTC e UI. Di seguito è descritto il flusso cronologico completo, mostrando l'interazione tra client e server in ordine temporale. Il flusso varia leggermente a seconda se il client è il primo a unirsi alla stanza (iniziatore) o arriva dopo (answerer).

#### 3.1 Sequenza Temporale Completa per un Nuovo Client

1. **Connessione Socket.IO e Unione Stanza**:
   - Utente inserisce `roomId` e clicca "Entra nella Stanza".
   - Client crea connessione Socket.IO: `this.socket = io()`.
   - Client emette `"join-room"` al server con `roomId`.
   - **Server risponde**: Invia `"users-in-room"` con lista peer esistenti (se presenti).

2. **Inizializzazione Connessioni verso Peer Esistenti**:
   - Per ogni `userId` nella lista ricevuta, client chiama `createPeerConnection(userId, true)` (è iniziatore verso gli esistenti).
   - Se la stanza era vuota, salta questo passo.

3. **Creazione PeerConnection per Ogni Peer**:
   - Istanzia `RTCPeerConnection` con STUN servers.
   - Se iniziatore: Crea `RTCDataChannel` per lo scambio di messaggi in chat.
   - Configura event handlers (ICE, DataChannel, stati connessione).
   - Se iniziatore: Genera SDP offer, imposta local description, invia `"offer"` al server (che la inoltra al target).

4. **Risposta dal Server e Peer Remoto**:
   - **Server inoltra**: L'offer arriva al peer target come evento `"offer"`.
   - Peer target (answerer) riceve `"offer"`, crea PeerConnection, imposta remote description, genera answer, invia `"answer"` al server.

5. **Ricezione Answer**:
   - Client riceve `"answer"` dal server, imposta remote description sulla propria PeerConnection.

6. **Scambio ICE Candidates**:
   - Entrambi i peer generano candidati ICE locali.
   - Ogni candidato viene inviato via `"ice-candidate"` al server, che lo inoltra all'altro peer.
   - Ricezione candidati: Vengono aggiunti alla PeerConnection con `addIceCandidate()`.
   - Una volta trovato un percorso valido, la connessione P2P è stabilita.

7. **Configurazione DataChannel**:
   - Se iniziatore: Il DataChannel creato viene negoziato automaticamente.
   - Se answerer: Riceve evento `ondatachannel` con il DataChannel creato dall'iniziatore.
   - Entrambi configurano handlers: `onopen`, `onmessage`, `onerror`, `onclose`.

8. **Connessione Stabilita**: I messaggi possono ora essere inviati direttamente via DataChannel.

#### 3.2 Gestione Nuovo Peer che si Unisce Dopo
Quando un nuovo peer si unisce alla stanza:
- **Server notifica**: Invia `"user-joined"` a tutti i peer esistenti, incluso il nuovo `userId`.
- **Peer esistenti reagiscono**: Chiamano `createPeerConnection(userId, true)` (sono iniziatori verso il nuovo).
- Il flusso ricomincia dal punto 3 per ogni peer esistente verso il nuovo.

#### 3.3 Ruoli Iniziatore vs Answerer
- **Iniziatore**: Peer che inizia la connessione (crea DataChannel, invia offer).
- **Answerer**: Peer che risponde (riceve offer, crea answer, riceve DataChannel).
- Un client può essere iniziatore verso alcuni peer e answerer verso altri, a seconda dell'ordine di arrivo.

#### 3.4 Invio e Ricezione Messaggi
Una volta connessi:
- **Invio**: `sendMessage()` formatta il messaggio come JSON e lo invia su tutti DataChannel aperti.
- **Ricezione**: `onmessage` del DataChannel riceve il JSON, lo parsa e aggiorna l'UI.
- Tutto avviene direttamente tra peer, senza passare dal server.

### 4. Gestione delle Stanze Multiple
- Ogni stanza è isolata: peer in stanze diverse non possono comunicare.
- Il server gestisce multiple stanze contemporaneamente nella `Map` `rooms`.
- L'ID stanza è scelto dall'utente e passato via Socket.IO.

### 5. Gestione Errori e Disconnessioni
- **Disconnessione Peer**: Il server emette `"user-left"`, e il client rimuove la PeerConnection corrispondente.
- **Errori di Rete**: Se la connessione ICE fallisce, la chat non funziona (NAT/firewall bloccano WebRTC).
- **Fallback**: Se non ci sono peer connessi, i messaggi vengono mostrati localmente con un avviso.

### 6. Sicurezza e Limitazioni
- **Nessuna Crittografia**: I messaggi WebRTC non sono crittografati end-to-end (a differenza di WebRTC sicuro).
- **HTTPS Richiesto**: Alcuni browser richiedono HTTPS per WebRTC in produzione.
- **NAT Traversal**: STUN aiuta, ma per reti complesse potrebbe servire TURN.
- **Server Temporaneo**: Il signaling server è necessario solo per l'handshake iniziale.

Questa implementazione dimostra un flusso WebRTC completo per chat peer-to-peer, con signaling via Socket.IO e comunicazione diretta via DataChannel.

## 📁 Struttura del Progetto

```
webchat-demo/
├── package.json          # Configurazione e dipendenze
├── server.js             # Server Express per signaling
├── public/               # File frontend
│   ├── index.html        # Pagina principale
│   ├── styles.css        # Stili CSS
│   └── app.js            # Logica WebRTC e UI
└── README.md             # Documentazione
```

## 🔧 Configurazione

### Variabili d'Ambiente

- `PORT`: Porta del server (default: 3000)

### STUN Server

Il progetto utilizza i server STUN di Google per la scoperta di rete:
- `stun:stun.l.google.com:19302`
- `stun:stun1.l.google.com:19302`

## 🐛 Troubleshooting

### Problemi Comuni

1. **"Connessione fallita"**
   - Verifica che il server sia in esecuzione
   - Controlla la console del browser per errori

2. **"Messaggi non arrivano"**
   - Assicurati che entrambi i browser siano nella stessa stanza
   - Verifica che non ci siano firewall che bloccano WebRTC

3. **"Errore WebRTC"**
   - Alcuni browser potrebbero richiedere HTTPS per WebRTC
   - Prova con browser diversi

### Debug

Apri la console del browser (F12) per vedere i log dettagliati:
- Connessioni WebRTC
- Messaggi Socket.IO
- Errori di rete

## 🚀 Sviluppo

### Modalità Development

```bash
npm run dev
```

Questo avvia il server con `nodemon` per il reload automatico.

### Estensioni Possibili

- **File Sharing**: Aggiungere supporto per condivisione file
- **Video Chat**: Integrare video e audio
- **Crittografia**: Aggiungere crittografia end-to-end
- **Persistenza**: Salvare i messaggi localmente
- **Notifiche**: Notifiche push per nuovi messaggi
