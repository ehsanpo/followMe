const sessionInput = document.getElementById('sessionId');
const passwordInput = document.getElementById('sessionPassword');
const createBtn = document.getElementById('createSession');
const joinBtn = document.getElementById('joinSession');
const warningBox = document.getElementById('warning');
const controlsPanel = document.getElementById('controlsPanel');
const statusPanel = document.getElementById('statusPanel');
const viewerPanel = document.getElementById('viewerPanel');
const cameraLight = document.getElementById('cameraLight');
const gpsLight = document.getElementById('gpsLight');
const videoStatus = document.getElementById('videoStatus');
const muteButton = document.getElementById('muteButton');
const chatLogStatus = document.getElementById('chatLogStatus');
const chatInputStatus = document.getElementById('chatInputStatus');
const sendChatStatus = document.getElementById('sendChatStatus');
const chatLogViewer = document.getElementById('chatLogViewer');
const chatInputViewer = document.getElementById('chatInputViewer');
const sendChatViewer = document.getElementById('sendChatViewer');
const gpsStatus = document.getElementById('gpsStatus');
const remoteVideo = document.getElementById('remoteVideo');
let map, marker;
let peer, currentCall, dataConnection;
let sessionPassword = '';
let authorizedViewers = new Set();
let localStream = null;
let isMicMuted = false;
let isCameraOn = true;
let isLocationOn = true;
let cameraFacingMode = 'user'; // 'user' = front, 'environment' = back
let gpsWatchId = null;
let wakeLock = null;

function parseQuery() {
  const params = new URLSearchParams(window.location.search);
  return {
    id: params.get('id') || '',
    role: params.get('role') || ''
  };
}

function setLight(element, isOn) {
  if (!element) return;
  element.classList.toggle('active', isOn);
}

function showPanel(panel) {
  controlsPanel.classList.add('hidden');
  statusPanel.classList.add('hidden');
  viewerPanel.classList.add('hidden');
  if (panel) panel.classList.remove('hidden');
}

function setGpsActive(isOn) {
  setLight(gpsLight, isOn);
}

function appendChatMessage(sender, message) {
  const line = document.createElement('div');
  line.textContent = `${sender}: ${message}`;
  line.style.padding = '4px 0';
  line.style.borderBottom = '1px solid rgba(255,255,255,0.05)';
  [chatLogStatus, chatLogViewer].forEach((log) => {
    if (log) log.appendChild(line.cloneNode(true));
  });
}

function sendChatMessage(message) {
  if (!message || !dataConnection || !dataConnection.open) return;
  dataConnection.send({ type: 'chat', text: message });
  appendChatMessage('You', message);
}

function toggleMute() {
  if (!localStream) return;
  isMicMuted = !isMicMuted;
  localStream.getAudioTracks().forEach((track) => {
    track.enabled = !isMicMuted;
  });
  muteButton.textContent = isMicMuted ? 'Unmute mic' : 'Mute mic';
}

function toggleCamera() {
  if (!localStream) return;
  isCameraOn = !isCameraOn;
  localStream.getVideoTracks().forEach((track) => {
    track.enabled = isCameraOn;
  });
  setLight(cameraLight, isCameraOn);
}

function toggleLocation() {
  if (!isLocationOn) {
    // Turn location back on
    isLocationOn = true;
    if ('geolocation' in navigator) {
      gpsWatchId = navigator.geolocation.watchPosition((position) => {
        const payload = {
          type: 'gps-update',
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          timestamp: Date.now()
        };
        setGpsActive(true);
        if (dataConnection && dataConnection.open) {
          dataConnection.send(payload);
        }
      }, (error) => {
        gpsStatus.textContent = `GPS error: ${error.message}`;
      }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 });
    }
  } else {
    // Turn location off
    isLocationOn = false;
    if (gpsWatchId !== null) {
      navigator.geolocation.clearWatch(gpsWatchId);
      gpsWatchId = null;
    }
  }
  setGpsActive(isLocationOn);
}

async function switchCamera() {
  if (!localStream) return;
  cameraFacingMode = cameraFacingMode === 'user' ? 'environment' : 'user';
  
  // Stop current video track
  localStream.getVideoTracks().forEach((track) => track.stop());
  
  try {
    const newStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: cameraFacingMode },
      audio: false
    });
    
    const newVideoTrack = newStream.getVideoTracks()[0];
    localStream.removeTrack(localStream.getVideoTracks()[0]);
    localStream.addTrack(newVideoTrack);
    
    // Send updated stream to active call
    if (currentCall && currentCall.peerConnection) {
      const sender = currentCall.peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
      if (sender) {
        await sender.replaceTrack(newVideoTrack);
      }
    }
  } catch (err) {
    logStatus(`Camera switch error: ${err.message}`);
    cameraFacingMode = cameraFacingMode === 'user' ? 'environment' : 'user';
  }
}

async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      console.log('Wake lock acquired.');
    }
  } catch (err) {
    console.warn('Wake lock failed:', err);
  }
}

function releaseWakeLock() {
  if (wakeLock) {
    wakeLock.release().catch(err => console.warn('Wake lock release error:', err));
    wakeLock = null;
  }
}

function initMap() {
  map = L.map('map').setView([20, 0], 2);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);
}

function showLocation(lat, lng) {
  if (!marker) {
    marker = L.marker([lat, lng]).addTo(map);
  } else {
    marker.setLatLng([lat, lng]);
  }
  map.setView([lat, lng], 14);
  gpsStatus.textContent = `Remote GPS: ${lat.toFixed(6)}, ${lng.toFixed(6)}`;
}

function logStatus(text) {
  videoStatus.textContent = text;
}

function showWarning(text) {
  if (!warningBox) return;
  if (!text) {
    warningBox.style.display = 'none';
    warningBox.textContent = '';
    return;
  }
  warningBox.style.display = 'block';
  warningBox.textContent = text;
}

function defaultPeerOptions() {
  return {
    host: '0.peerjs.com',
    port: 443,
    secure: true,
    config: {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    }
  };
}

function startPeer(sessionId) {
  peer = new Peer(sessionId, defaultPeerOptions());

  peer.on('open', () => {
    logStatus(`Peer ready.`);
  });

  peer.on('error', (err) => {
    logStatus(`Peer error: ${err}`);
    console.error(err);
  });
}

async function startBroadcast(sessionId) {
  createBtn.disabled = true;
  joinBtn.disabled = true;

  sessionPassword = passwordInput.value.trim();
  if (!sessionPassword) {
    alert('Please enter a password for this stream before starting broadcast.');
    createBtn.disabled = false;
    joinBtn.disabled = false;
    return;
  }

  requestWakeLock();

  startPeer(sessionId || `followme-${Math.random().toString(36).slice(2, 10)}`);

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localStream = stream;
    isMicMuted = false;
    isCameraOn = true;
    isLocationOn = true;
    if (muteButton) muteButton.textContent = 'Mute mic';
    showPanel(statusPanel);
    setLight(cameraLight, true);
    setLight(gpsLight, true);
  } catch (err) {
    logStatus(`Camera/microphone error: ${err.message}`);
    createBtn.disabled = false;
    joinBtn.disabled = false;
    releaseWakeLock();
    return;
  }

  peer.on('call', (call) => {
    if (authorizedViewers.has(call.peer)) {
      call.answer(stream);
      currentCall = call;
      logStatus('Viewer connected. Streaming video...');
      call.on('close', () => logStatus('Viewer disconnected.'));
      call.on('error', (err) => console.error(err));
    } else {
      console.warn('Rejected call from unauthorized peer:', call.peer);
      call.close();
    }
  });

  peer.on('connection', (conn) => {
    conn.on('data', (data) => {
      if (data.type === 'join-request') {
        if (data.password !== sessionPassword) {
          conn.send({ type: 'auth-result', success: false, message: 'Invalid password.' });
          console.warn('Viewer attempted to join with wrong password:', conn.peer);
          return;
        }

        authorizedViewers.add(conn.peer);
        dataConnection = conn;
        conn.send({ type: 'auth-result', success: true, message: 'Password correct. Sending video.' });
        gpsStatus.textContent = 'Viewer authorized. Waiting for viewer request.';
      }
      if (data.type === 'chat') {
        appendChatMessage('Viewer', data.text);
      }
    });

    conn.on('error', (err) => console.error('Host data connection error:', err));
  });

  if ('geolocation' in navigator) {
    gpsWatchId = navigator.geolocation.watchPosition((position) => {
      const payload = {
        type: 'gps-update',
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        timestamp: Date.now()
      };
      setGpsActive(true);
      if (dataConnection && dataConnection.open) {
        dataConnection.send(payload);
      }
    }, (error) => {
      gpsStatus.textContent = `GPS error: ${error.message}`;
    }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 });
  } else {
    gpsStatus.textContent = 'Geolocation unavailable.';
  }
}

function joinAsViewer(sessionId) {
  createBtn.disabled = true;
  joinBtn.disabled = true;

  const password = passwordInput.value.trim();
  if (!password) {
    alert('Please enter the stream password before joining.');
    createBtn.disabled = false;
    joinBtn.disabled = false;
    return;
  }

  peer = new Peer(undefined, defaultPeerOptions());
  peer.on('call', (call) => {
    currentCall = call;
    call.answer();
    call.on('stream', (remoteStream) => {
      remoteVideo.srcObject = remoteStream;
      videoStatus.textContent = 'Live video received.';
      remoteVideo.muted = false;
      remoteVideo.play().catch(() => {});
    });
    call.on('error', (err) => console.error(err));
  });
  peer.on('open', () => {
    logStatus('Connecting to host...');

    dataConnection = peer.connect(sessionId);
    dataConnection.on('open', () => {
      dataConnection.send({ type: 'join-request', password });
    });
    dataConnection.on('data', (data) => {
      if (data.type === 'auth-result') {
        if (!data.success) {
          logStatus(`Auth failed: ${data.message}`);
          alert('Stream password is incorrect.');
          createBtn.disabled = false;
          joinBtn.disabled = false;
          showPanel(controlsPanel);
          return;
        }
        logStatus('Authorized; requesting host video...');
        showPanel(viewerPanel);
        try {
          const emptyStream = new MediaStream();
          peer.call(sessionId, emptyStream);
        } catch (err) {
          console.warn('Viewer stream request failed:', err);
        }
        return;
      }
      if (data.type === 'gps-update') {
        showLocation(data.latitude, data.longitude);
      }
      if (data.type === 'chat') {
        appendChatMessage('Host', data.text);
      }
    });
    dataConnection.on('error', (err) => console.error('Viewer data connection error:', err));
  });

  peer.on('error', (err) => {
    logStatus(`Peer error: ${err}`);
    console.error(err);
    createBtn.disabled = false;
    joinBtn.disabled = false;
    showPanel(controlsPanel);
  });
}

createBtn.addEventListener('click', () => {
  const sessionId = sessionInput.value.trim();
  startBroadcast(sessionId);
});

joinBtn.addEventListener('click', () => {
  const sessionId = sessionInput.value.trim();
  if (!sessionId) {
    alert('Please enter the same Session ID shared by the broadcaster.');
    return;
  }
  joinAsViewer(sessionId);
});

if (muteButton) {
  muteButton.addEventListener('click', toggleMute);
}

if (sendChatStatus) {
  sendChatStatus.addEventListener('click', () => {
    const message = chatInputStatus.value.trim();
    if (!message) return;
    sendChatMessage(message);
    chatInputStatus.value = '';
  });
}

if (sendChatViewer) {
  sendChatViewer.addEventListener('click', () => {
    const message = chatInputViewer.value.trim();
    if (!message) return;
    sendChatMessage(message);
    chatInputViewer.value = '';
  });
}

const toggleCameraBtn = document.getElementById('toggleCameraBtn');
const toggleLocationBtn = document.getElementById('toggleLocationBtn');
const switchCameraBtn = document.getElementById('switchCameraBtn');

if (toggleCameraBtn) {
  toggleCameraBtn.addEventListener('click', () => {
    toggleCamera();
    toggleCameraBtn.textContent = isCameraOn ? 'Turn off camera' : 'Turn on camera';
  });
}

if (toggleLocationBtn) {
  toggleLocationBtn.addEventListener('click', () => {
    toggleLocation();
    toggleLocationBtn.textContent = isLocationOn ? 'Turn off GPS' : 'Turn on GPS';
  });
}

if (switchCameraBtn) {
  switchCameraBtn.addEventListener('click', () => {
    switchCamera();
  });
}

[chatInputStatus, chatInputViewer].forEach((input) => {
  if (!input) return;
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      const msg = input.value.trim();
      if (!msg) return;
      sendChatMessage(msg);
      input.value = '';
    }
  });
});

window.addEventListener('load', () => {
  initMap();
  if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1' && window.location.hostname !== '[::1]') {
    showWarning('This page is loaded over HTTP. Phone camera and GPS may be blocked unless the page is served over HTTPS or loaded from localhost on the phone.');
  }
  const query = parseQuery();
  if (query.id) {
    sessionInput.value = query.id;
    showPanel(controlsPanel);
  }
});
