// Workaround for a very old Chrome bug
// Bug: https://bugs.chromium.org/p/chromium/issues/detail?id=933677
// Workaround: https://stackoverflow.com/questions/24287054/chrome-wont-play-webaudio-getusermedia-via-webrtc-peer-js
function workaroundChromeRemoteAudioStreamBug(stream) {
    let audio = new Audio();
    audio.muted = true;
    audio.srcObject = stream;
}

async function createPeerAsync() {
    return new Promise(function (resolve) {
        const peer = new Peer();
        peer.on("open", function () {
            resolve(peer);
        });
    });
}

async function joinAndGetParticipantIdsAsync(roomId, participantId) {
    const response = await fetch("/join", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            roomId: roomId,
            participantId: participantId
        })
    });
    const json = await response.json();
    return json.participantIds;
}

async function leaveAsync(roomId, participantId) {
    await fetch("/leave", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            roomId: roomId,
            participantId: participantId
        })
    });
}

async function startAudioStreamAsync() {
    return await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false
    });
}

function stopAudioStream(stream) {
    stream.getTracks().forEach(function (track) {
        track.stop();
    });
}

const canvas = document.getElementById("babylon-canvas");
class MeetingData {
    babylonExperience = undefined;
    avatars = new Map();
    audioStream = undefined;
    peer = undefined;
    active = false;

    reset() {
        this.active = false;
        
        this.peer.destroy();
        this.peer = undefined;

        stopAudioStream(this.audioStream);
        this.audioStream = undefined;
        
        this.avatars.clear();
        
        this.babylonExperience.dispose();
        this.babylonExperience = undefined;
    }
};
let meetingData = new MeetingData();

async function joinMeetingAsync() {
    meetingData.active = true;
    // TODO: Hide instructions splash.

    meetingData.babylonExperience = new BabylonExperience(canvas);
    meetingData.audioStream = await startAudioStreamAsync();
    meetingData.peer = await createPeerAsync();

    function handleDataConnection(dataConnection) {
        const avatar = meetingData.babylonExperience.createAvatar();

        dataConnection.on("open", function () {
            dataConnection.on("data", function (data) {
                avatar.update(data);
            });
            const observer = meetingData.babylonExperience.participantDataUpdatedObservable.add(function (data) {
                if (!dataConnection.open) {
                    meetingData.babylonExperience.participantDataUpdatedObservable.remove(observer);
                    avatar.dispose();
                    meetingData.avatars.delete(dataConnection.peer);
                } else {
                    dataConnection.send(data);
                }
            });
        });
        dataConnection.on("error", function (error) {
            console.error(error);
        });
        
        meetingData.avatars.set(dataConnection.peer, avatar);
    }

    function handleMediaConnection(mediaConnection) {
        mediaConnection.on("stream", function (stream) {
            workaroundChromeRemoteAudioStreamBug(stream);
            meetingData.avatars.get(mediaConnection.peer).setAudioStream(stream);
        });
        mediaConnection.on("error", function (error) {
            console.error(error);
        });
    }

    meetingData.peer.on("call", function (mediaConnection) {
        mediaConnection.answer(meetingData.audioStream);
        handleMediaConnection(mediaConnection);
    });

    meetingData.peer.on("connection", function (dataConnection) {
        const mediaConnection = meetingData.peer.call(dataConnection.peer, meetingData.audioStream);
        handleDataConnection(dataConnection);
        handleMediaConnection(mediaConnection);
    });

    const participantIds = await joinAndGetParticipantIdsAsync(ROOM_ID, meetingData.peer.id);
    participantIds.forEach(function (participantId) {
        if (participantId !== meetingData.peer.id) {
            const dataConnection = meetingData.peer.connect(participantId, {reliable: false});
            handleDataConnection(dataConnection);
        }
    });
}

async function leaveMeetingAsync() {
    await leaveAsync(ROOM_ID, meetingData.peer.id);
    meetingData.reset();
    // TODO: Hide instructions splash.
}

// Get microphone permission.
startAudioStreamAsync().then(function (stream) {
    stopAudioStream(stream);
});

// Set up call handling.
const button = document.getElementById("phone-button");
button.addEventListener("click", async function () {
    button.disabled = true;
    if (meetingData.active) {
        await leaveMeetingAsync();
    } else {
        await joinMeetingAsync();
    }
    button.disabled = false;
});
