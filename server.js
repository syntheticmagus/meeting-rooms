const express = require("express");
const app = express();
const server = require("http").Server(app);
const randomWords = require("random-words");

// TODO: Replace this with a database.
const roomToParticipantIds = new Map();

app.set("view engine", "ejs");
app.use(express.static("public"));
app.use(express.json());

app.get("/", function (request, response) {
    response.redirect(`/${ randomWords({ exactly: 3, join: "-" }) }`);
});

app.get("/:roomId", function (request, response) {
    const roomId = request.params.roomId;
    response.render("room", { roomId: roomId });
});

app.post("/join", function (request, response) {
    const roomId = request.body.roomId;
    const participantId = request.body.participantId;
    
    console.log(`Participant ${participantId} joined room ${roomId}.`);
    
    if (!roomToParticipantIds.has(roomId)) {
        roomToParticipantIds.set(roomId, new Set());
    }
    roomToParticipantIds.get(roomId).add(participantId);

    let participantIds = [];
    roomToParticipantIds.get(roomId).forEach(function (participantId) {
        participantIds.push(participantId);
    });
    response.status("200").send({ participantIds: participantIds });
});

app.post("/leave", function (request, response) {
    const roomId = request.body.roomId;
    const participantId = request.body.participantId;
 
    console.log(`Participant ${participantId} left room ${roomId}.`);

    if (!roomToParticipantIds.has(roomId)) {
        response.status("400").send();
    } else {
        const participantIds = roomToParticipantIds.get(roomId);
        participantIds.delete(participantId);
        if (participantIds.size === 0) {
            roomToParticipantIds.delete(roomId);
        }
        response.status("200").send();
    }
});

server.listen(process.env.PORT || 3000);
