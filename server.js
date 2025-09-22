// questo file definisce il Server Express per signaling
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Middleware
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// Store delle connessioni attive
const rooms = new Map();

// Gestione connessioni Socket.IO
io.on('connection', (socket) => {
  console.log('Nuovo client connesso:', socket.id);

  // Un utente vuole creare o unirsi a una stanza
  socket.on('join-room', (roomId) => {
    socket.join(roomId);
    
    if (!rooms.has(roomId)) {
      rooms.set(roomId, new Set());
    }
    
    rooms.get(roomId).add(socket.id);
    
    console.log(`Client ${socket.id} si è unito alla stanza ${roomId}`);
    
    // Notifica agli altri client nella stanza
    socket.to(roomId).emit('user-joined', socket.id);
    
    // Invia la lista degli utenti già presenti
    const usersInRoom = Array.from(rooms.get(roomId)).filter(id => id !== socket.id);
    socket.emit('users-in-room', usersInRoom);
  });

  // Forwarding dei messaggi WebRTC tra peer
  socket.on('offer', (data) => {
    socket.to(data.target).emit('offer', {
      offer: data.offer,
      sender: socket.id
    });
  });

  socket.on('answer', (data) => {
    socket.to(data.target).emit('answer', {
      answer: data.answer,
      sender: socket.id
    });
  });

  socket.on('ice-candidate', (data) => {
    socket.to(data.target).emit('ice-candidate', {
      candidate: data.candidate,
      sender: socket.id
    });
  });

  // Gestione disconnessione
  socket.on('disconnect', () => {
    console.log('Client disconnesso:', socket.id);
    
    // Rimuovi il client da tutte le stanze
    rooms.forEach((users, roomId) => {
      if (users.has(socket.id)) {
        users.delete(socket.id);
        socket.to(roomId).emit('user-left', socket.id);
        
        // Se la stanza è vuota, rimuovila
        if (users.size === 0) {
          rooms.delete(roomId);
        }
      }
    });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server in ascolto sulla porta ${PORT}`);
  console.log(`Apri http://localhost:${PORT} nel browser`);
});
