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

