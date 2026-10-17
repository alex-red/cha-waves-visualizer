# Optional phone microphone satellite

The satellite mode pairs this browser app with a phone over Tailscale HTTPS, trusted LAN HTTPS or Android USB forwarding. The phone plays and records the chirp itself, so its speaker and microphone stay together. It uploads short PCM16 samples and a position that the user labels in metres. The desktop app can then review those captures alongside its modeled measurements.

This is an optional, same-origin relay. It does not track the phone's position, synchronize microphones, or provide physical acoustic calibration. The marked positions are user supplied coordinates; the captures remain measured audio samples rather than calibrated sound-pressure measurements.

## Build and run

Build the generated static app first:

```sh
bun run build
```

For local desktop development, serve it on loopback over HTTP:

```sh
bun run satellite -- --host 127.0.0.1 --port 4174
```

Open `http://127.0.0.1:4174`. Loopback HTTP is useful for desktop testing. For phone capture, choose either the Android USB route below or trusted LAN HTTPS. A phone browser requires a secure context for microphone access; the USB route exposes the relay through the phone's `localhost`, while wireless LAN use needs HTTPS with a certificate trusted by the phone and valid for the LAN hostname or IP address.

For a trusted LAN HTTPS setup, create or obtain a certificate whose subject names include the server's LAN address (and whose issuing CA the phone trusts), then run:

```sh
bun run satellite -- --port 4174 --cert ./certs/lan.pem --key ./certs/lan-key.pem
```

The server prints usable LAN HTTPS origins for private IPv4 interfaces. Open a trusted origin on the desktop and choose a phone origin that resolves to the same server and is covered by the certificate. Each browser must send API requests to the same origin from which it loaded the app; the desktop and phone may use different hostnames or IPs for that same server. The session response also includes LAN IPv4 origin suggestions. The server's Origin check rejects cross-origin API use and it does not enable CORS.

Android Chrome is the preferred phone target for this experimental workflow. Before pairing, open the exact HTTPS LAN origin on the phone and confirm the browser trusts the certificate and reports a secure context (`window.isSecureContext` is `true`). The page should be able to request microphone permission; if it cannot, fix the certificate or origin before recording. Direct LAN HTTP still cannot record; the Android USB route uses the forwarded localhost origin instead.

## Wireless HTTPS with Tailscale

Tailscale Serve provides a trusted HTTPS endpoint inside the tailnet. Connect both the computer and Android phone to the same tailnet. No USB cable or local certificate installation is needed. See the official [Tailscale Serve guide](https://tailscale.com/docs/features/tailscale-serve) and [CLI reference](https://tailscale.com/docs/reference/tailscale-cli/serve).

1. Find the computer's full `*.ts.net` hostname with `tailscale status`. Keep any existing Serve configuration when selecting an HTTPS port.
2. Run the relay on loopback, explicitly naming its external HTTPS origin. Replace the example hostname with the computer's hostname; omit the trailing slash:

   ```sh
   bun run satellite -- --host 127.0.0.1 --port 4175 --external-origin https://your-device.your-tailnet.ts.net
   ```

3. In another terminal, proxy HTTPS to that loopback relay:

   ```sh
   tailscale serve --bg --https=443 http://127.0.0.1:4175
   ```

   On macOS, if `tailscale` is not on PATH, use `/Applications/Tailscale.app/Contents/MacOS/Tailscale` in place of `tailscale`.
4. Open the printed HTTPS URL on the computer. In Echo Lab → Phone satellite, leave **Wireless HTTPS** selected and choose **Pair a phone**. Scan the QR on Android and open it in Chrome while Tailscale is connected.

The relay explicitly allows the configured browser origin only through a loopback proxy with a matching external or loopback Host. It does not infer trust from forwarded headers or enable CORS. Its ordinary direct same-origin behavior remains available locally. HTTPS-origin suggestions retain the Tailscale hostname for the QR link.

The Serve route stays available within the tailnet while the relay and Tailscale are running. To remove only the HTTPS listener created by the command above:

```sh
tailscale serve --https=443 off
```

Local verification on October 16, 2026 confirmed certificate-valid HTTPS, session creation, phone-join API behavior and session retirement through the actual Serve endpoint. Twenty relay/Android-helper tests passed, including reverse-proxy origin restrictions. A subsequent Android Chrome test paired and sent three built-in-speaker/microphone recordings at known positions over Tailscale HTTPS. This verified capture and transport, but the echoes did not support room reconstruction; see the [recording comparison](ECHO_LAB.md#compare-recordings-before-choosing-walls). Physical timing calibration and room-mapping accuracy remain unvalidated.

## Optional Android USB first test

The USB route is useful when the phone and computer are not using the same Wi-Fi network or a trusted LAN certificate is not available. It uses Chrome's secure `localhost` context over an ADB reverse port tunnel. It does not enable Developer options or USB debugging, authorize the computer, install software on the phone, or install/trust a certificate for wireless access. You must do the phone's debugging setup yourself and accept its authorization prompt.

1. Connect the Android phone to the computer with a data-capable USB cable. On the phone, enable Developer options and USB debugging, unlock it, and accept the computer's debugging authorization prompt.
2. Build the app, then start the ordinary relay server on port 4175:

   ```sh
   bun run build
   bun run satellite -- --host 127.0.0.1 --port 4175
   ```

3. In another terminal, create the reverse tunnel:

   ```sh
   bun run satellite:android -- --port 4175
   ```

   The helper requires `adb` (Android Platform Tools) on the computer. If more than one authorized device is connected, select one with `--serial SERIAL`. Use `--check` to inspect this port's tunnel without changing it, or `--remove` to remove only this port's reverse mapping from the selected device.
4. Open the relay on the desktop at `http://localhost:4175`. In Echo Lab's phone connection controls, choose **Android USB**, create the pairing QR, then scan it with the phone's camera and open it in Chrome. The link uses `http://localhost:4175` on the phone; the session token remains in the URL fragment.

Keep the USB connection and relay server running during capture. If the tunnel is missing or the phone cannot load the page, unlock and reauthorize the device as needed, rerun the helper, and confirm the port matches the relay. For background on the browser and Android behavior, see Chrome's [remote debugging and local-server guide](https://developer.chrome.com/docs/devtools/remote-debugging/local-server) and Android's [accessing a local development server](https://developer.android.com/develop/ui/views/layout/webapps/access-local-server).

## Pair and capture

Create a session in the desktop app and open its pairing link or QR code on the phone. The session token is a random bearer secret. Keep the pairing link private while the session is active. Sessions expire after 30 minutes and can be ended from the desktop. The relay keeps at most 32 sessions, 12 captures per session, and 1,024 accepted capture IDs per session in memory. By default it does not write audio to disk. The optional [local owner API](ECHO_LOCAL_API.md) archives accepted recordings privately and lets `bun run echo:pull` retrieve them; it uses a separate authenticated loopback port that is not exposed through Tailscale. Desktop review edits still require a browser export. Responses use `Cache-Control: no-store`.

On the phone, grant microphone access and label the measurement position in the app's metre coordinate system. Repeated-probe mode records one pose batch: one MediaStream and AudioContext, a 1 s software-clock warmup target, then five separate 700 ms mono PCM windows scheduled at least 1 s apart. The first probe waits until the target is reached; if the context is delayed, it starts later. An interrupted warmup may produce a shorter partial manifest with no captured probes. AudioWorklet is the primary capture path; browsers without it retain the clearly labeled ScriptProcessor compatibility path. The single-capture mode remains available for compatibility. Each attempt is marked `captured`, `interrupted`, or `not-started`; completed probe PCM remains available if later attempts are interrupted. A page hide/exit, ended microphone track, or stopped audio context cancels the batch. The microphone stops before the user reviews or sends it.

Record manual metadata for the pose: height from 0 to 5 m; orientation (`screen-up`, `screen-down`, or `upright`); heading from 0 up to but not including 360 degrees, measured clockwise from the room's +X axis and manually reported. For a flat phone, heading is the direction of its top edge; for an upright phone, it is the direction the screen faces. Record speaker volume from 0 to 100 percent as reported by the user. These are user reports, not sensor measurements. Probe level uses software gain 0.1; it does not change hardware volume. Keep the phone's axes and pose labels consistent across measurements.

Pairing and upload requests time out after ten seconds. Batch upload is atomic and retries use the same probe and batch IDs; an over-limit batch is explicitly rejected without evicting received data. The relay and scan each allow at most 12 probe captures, so each of the five probes consumes one slot. A three-pose session with five repeats per pose requires exporting the scan and starting a new pairing session between poses. A local batch JSON download remains available even when the relay rejects a batch. Reloading or closing the page discards unsent data unless the user has downloaded the batch JSON. The relay validates sample rate and duration, then makes accepted captures available to the desktop app.

Peak level, RMS and clipping fraction are descriptive signal checks only. Each capture also retains optional acquisition metadata: requested constraints, browser-reported track settings, scheduled AudioContext frames, and AudioWorklet input-continuity counters when observed. These do not verify the complete hardware processing path, measure acoustic arrival time, or calibrate the microphone. See [ECHO_ACQUISITION.md](ECHO_ACQUISITION.md) for interpretation and limits.

The desktop exports version 3 scans containing raw PCM, stable peak-review indices, optional batch manifests, and acquisition metadata when available. Legacy imports preserve their existing recordings and reviews without invented batch history. Derived reconstruction is recalculated after import. Import replaces the current Echo Lab scan, with a restore action to reverse that replacement; scans are not autosaved. See [ECHO_SCAN_FORMAT.md](ECHO_SCAN_FORMAT.md) for the portable format and migration details.

The relay server preserves the generated static security headers and permits only the same-origin microphone (`microphone=(self)`). Camera and geolocation remain disabled. Binding to `0.0.0.0` makes the service reachable on the LAN; use a firewall rule appropriate for the network where it runs. USB's localhost route uses the same relay origin and microphone policy as wireless HTTPS pairing.
