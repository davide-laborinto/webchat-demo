// questo file contiene la Logica WebRTC e UI
class WebRTCChat {
    constructor() {
        this.socket = null;
        this.peerConnections = new Map();
        this.dataChannel = null;
        this.currentRoom = null;
        this.isConnected = false;
        
        this.initializeElements();
        this.setupEventListeners();
    }

    initializeElements() {
        this.roomIdInput = document.getElementById('roomId');
        this.joinRoomBtn = document.getElementById('joinRoom');
        this.connectionStatus = document.getElementById('connectionStatus');
        this.chatContainer = document.getElementById('chatContainer');
        this.currentRoomSpan = document.getElementById('currentRoom');
        this.peerCountSpan = document.getElementById('peerCount');
        this.messagesContainer = document.getElementById('messagesContainer');
        this.messageInput = document.getElementById('messageInput');
        this.sendMessageBtn = document.getElementById('sendMessage');
    }

    setupEventListeners() {
        this.joinRoomBtn.addEventListener('click', () => this.joinRoom());
        this.sendMessageBtn.addEventListener('click', () => this.sendMessage());
        
        this.messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.sendMessage();
            }
        });

        this.roomIdInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.joinRoom();
            }
        });
    }

    async joinRoom() {
        const roomId = this.roomIdInput.value.trim();
        if (!roomId) {
            alert('Inserisci un ID stanza valido');
            return;
        }

        this.updateStatus('connecting', 'Connessione in corso...');
        this.joinRoomBtn.disabled = true;

        try {
            // Connessione Socket.IO
            this.socket = io();
            this.currentRoom = roomId;

            // Setup eventi Socket.IO
            this.setupSocketEvents();

            // Unisciti alla stanza
            this.socket.emit('join-room', roomId);

        } catch (error) {
            console.error('Errore durante la connessione:', error);
            this.updateStatus('disconnected', 'Errore di connessione');
            this.joinRoomBtn.disabled = false;
        }
    }

    setupSocketEvents() {
        this.socket.on('connect', () => {
            console.log('Connesso al server');
        });

        this.socket.on('user-joined', (userId) => {
            console.log('Nuovo utente connesso:', userId);
            this.createPeerConnection(userId);
        });

        this.socket.on('user-left', (userId) => {
            console.log('Utente disconnesso:', userId);
            this.removePeerConnection(userId);
            this.updatePeerCount();
        });

        this.socket.on('users-in-room', (users) => {
            console.log('Utenti nella stanza:', users);
            users.forEach(userId => this.createPeerConnection(userId));
            
            // Mostra la chat non appena ci si unisce alla stanza
            this.showChatInterface();
        });

        this.socket.on('offer', async (data) => {
            await this.handleOffer(data.offer, data.sender);
        });

        this.socket.on('answer', async (data) => {
            await this.handleAnswer(data.answer, data.sender);
        });

        this.socket.on('ice-candidate', async (data) => {
            await this.handleIceCandidate(data.candidate, data.sender);
        });

        this.socket.on('disconnect', () => {
            this.updateStatus('disconnected', 'Disconnesso dal server');
            this.isConnected = false;
            this.joinRoomBtn.disabled = false;
        });
    }

    async createPeerConnection(userId) {
        if (this.peerConnections.has(userId)) {
            return;
        }

        const peerConnection = new RTCPeerConnection({
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        });

        // Crea data channel per questo peer (solo se siamo il primo a connetterci)
        let dataChannel = null;
        if (this.peerConnections.size === 0) {
            dataChannel = peerConnection.createDataChannel('messages', {
                ordered: true
            });
            this.setupDataChannel(dataChannel, userId);
        }

        // Gestione ICE candidates
        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                this.socket.emit('ice-candidate', {
                    target: userId,
                    candidate: event.candidate
                });
            }
        };

        // Gestione data channel in arrivo
        peerConnection.ondatachannel = (event) => {
            const incomingDataChannel = event.channel;
            this.setupDataChannel(incomingDataChannel, userId);
        };

        // Gestione connessione stabilita
        peerConnection.onconnectionstatechange = () => {
            console.log(`Stato connessione con ${userId}:`, peerConnection.connectionState);
            if (peerConnection.connectionState === 'connected') {
                this.updateStatus('connected', 'Connesso');
                this.isConnected = true;
                this.updatePeerCount();
            }
        };

        // Salva il data channel nel peer connection
        peerConnection.dataChannel = dataChannel;
        this.peerConnections.set(userId, peerConnection);

        // Se abbiamo creato un data channel, creiamo l'offer
        if (dataChannel) {
            try {
                const offer = await peerConnection.createOffer();
                await peerConnection.setLocalDescription(offer);
                
                this.socket.emit('offer', {
                    target: userId,
                    offer: offer
                });
                console.log(`Offer inviata a ${userId}`);
            } catch (error) {
                console.error('Errore nella creazione dell\'offer:', error);
            }
        }
    }

    setupDataChannel(dataChannel, userId) {
        dataChannel.onopen = () => {
            console.log(`Data channel aperto con ${userId}`);
        };

        dataChannel.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                this.displayMessage(message.content, `Peer ${userId.substring(0, 8)}`, false);
            } catch (error) {
                console.error('Errore nel parsing del messaggio:', error);
            }
        };

        dataChannel.onerror = (error) => {
            console.error('Errore nel data channel:', error);
        };

        dataChannel.onclose = () => {
            console.log(`Data channel chiuso con ${userId}`);
        };
    }

    async handleOffer(offer, sender) {
        console.log(`Ricevuto offer da ${sender}`);
        const peerConnection = this.peerConnections.get(sender);
        if (!peerConnection) {
            await this.createPeerConnection(sender);
            const newPeerConnection = this.peerConnections.get(sender);
            await newPeerConnection.setRemoteDescription(offer);
            
            const answer = await newPeerConnection.createAnswer();
            await newPeerConnection.setLocalDescription(answer);
            
            this.socket.emit('answer', {
                target: sender,
                answer: answer
            });
            console.log(`Answer inviata a ${sender}`);
        } else {
            await peerConnection.setRemoteDescription(offer);
            
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);
            
            this.socket.emit('answer', {
                target: sender,
                answer: answer
            });
            console.log(`Answer inviata a ${sender}`);
        }
    }

    async handleAnswer(answer, sender) {
        console.log(`Ricevuto answer da ${sender}`);
        const peerConnection = this.peerConnections.get(sender);
        if (peerConnection) {
            await peerConnection.setRemoteDescription(answer);
            console.log(`Answer processata da ${sender}`);
        }
    }

    async handleIceCandidate(candidate, sender) {
        console.log(`Ricevuto ICE candidate da ${sender}`);
        const peerConnection = this.peerConnections.get(sender);
        if (peerConnection) {
            await peerConnection.addIceCandidate(candidate);
            console.log(`ICE candidate aggiunto da ${sender}`);
        }
    }

    removePeerConnection(userId) {
        const peerConnection = this.peerConnections.get(userId);
        if (peerConnection) {
            peerConnection.close();
            this.peerConnections.delete(userId);
            this.updatePeerCount();
        }
    }

    sendMessage() {
        const message = this.messageInput.value.trim();
        if (!message || !this.isConnected) {
            return;
        }

        // Invia il messaggio a tutti i peer connessi
        const messageData = {
            content: message,
            sender: this.socket.id,
            timestamp: new Date().toISOString()
        };

        let messageSent = false;
        this.peerConnections.forEach((peerConnection, userId) => {
            if (peerConnection.connectionState === 'connected') {
                const dataChannel = peerConnection.dataChannel;
                
                if (dataChannel && dataChannel.readyState === 'open') {
                    dataChannel.send(JSON.stringify(messageData));
                    messageSent = true;
                    console.log(`Messaggio inviato a ${userId}`);
                } else {
                    console.log(`Data channel non disponibile per ${userId}, stato:`, dataChannel?.readyState);
                }
            } else {
                console.log(`Peer ${userId} non connesso, stato:`, peerConnection.connectionState);
            }
        });

        // Mostra il messaggio nella nostra chat
        this.displayMessage(message, 'Tu', true);
        this.messageInput.value = '';
        
        // Se non ci sono peer connessi, mostra un messaggio informativo
        if (!messageSent && this.peerConnections.size === 0) {
            this.displayMessage('Nessun peer connesso. Il messaggio è stato salvato localmente.', 'Sistema', false);
        }
    }

    displayMessage(content, sender, isOwn) {
        const messageDiv = document.createElement('div');
        
        // Determina la classe CSS in base al tipo di messaggio
        if (sender === 'Sistema') {
            messageDiv.className = 'message system';
        } else {
            messageDiv.className = `message ${isOwn ? 'own' : 'other'}`;
        }
        
        const timestamp = new Date().toLocaleTimeString();
        
        if (sender === 'Sistema') {
            messageDiv.innerHTML = `
                <div class="message-content">${this.escapeHtml(content)}</div>
            `;
        } else {
            messageDiv.innerHTML = `
                <div class="message-header">${sender} - ${timestamp}</div>
                <div class="message-content">${this.escapeHtml(content)}</div>
            `;
        }
        
        this.messagesContainer.appendChild(messageDiv);
        this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
    }

    updateStatus(status, text) {
        this.connectionStatus.className = `status ${status}`;
        this.connectionStatus.textContent = text;
    }

    updatePeerCount() {
        this.peerCountSpan.textContent = this.peerConnections.size;
    }

    showChatInterface() {
        this.chatContainer.style.display = 'block';
        this.currentRoomSpan.textContent = this.currentRoom;
        this.updateStatus('connected', 'Nella stanza - Aspettando connessioni peer...');
        this.isConnected = true;
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Inizializza l'app quando il DOM è caricato
document.addEventListener('DOMContentLoaded', () => {
    new WebRTCChat();
});