 # FollowMe P2P Stream

 A tiny static demo for peer-to-peer camera + GPS sharing using WebRTC.

 ## What it does
 - One device starts as broadcaster and shares camera + GPS.
 - Another device connects as viewer and sees remote video plus a map marker.
 - Each stream is protected by a shared password handshake before video starts.
 - The browser media path itself is encrypted by WebRTC (DTLS/SRTP).

 ## How to run
 1. Serve this folder over HTTP. For example, in PowerShell:

```powershell
cd c:\Users\Ehsan\followMe
python -m http.server 8080
```

 2. Open `http://localhost:8080` on both devices.
 3. On the broadcaster phone, choose a `Session ID`, enter a stream password, and click `Create / Start Broadcast`.
 4. Share the same `Session ID` and password with the viewer.
 5. On the viewer PC, enter the same `Session ID`, enter the password, and click `Join as Viewer`.

## Notes
- `getUserMedia` and `geolocation` require HTTPS or localhost.
- This demo uses the public PeerJS signaling server for connection setup.
- If you need a fully private setup, you can self-host a PeerJS server.
