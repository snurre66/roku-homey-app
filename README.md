# Roku for Homey (SDK v3)

Control your Roku TVs and Roku Streaming Players locally via Roku's official **External Control Protocol (ECP)**.

## Architecture & Features

- **Device Class & Remote UI**: Configured with `"class": "tv"` in [`drivers/roku/driver.compose.json`](file:///home/antigravity/roku-homey-app/drivers/roku/driver.compose.json) to activate Homey's native TV remote widget.
- **Standard Capabilities**: `onoff`, `volume_up`, `volume_down`, `volume_mute`, `channel_up`, `channel_down`, `speaker_playing`, `speaker_next`, `speaker_prev`.
- **Dynamic Capability Adaptation (`<is-tv>`)**: Automatically inspects `<is-tv>` from `GET /query/device-info` and removes unsupported TV hardware capabilities (`volume_*`, `channel_*`) on Roku Streaming Sticks while retaining full TV controls on Roku TVs.
- **Custom Capability**: `roku_active_app` (string) displays the currently active channel/app (e.g., Netflix, YouTube, Plex).
- **Pairing (SSDP + Manual IP Fallback)**:
  - Automatically discovers Roku devices on the local LAN using SSDP (`roku:ecp`).
  - Includes a manual IP address and port entry fallback (`manual_ip.html`) for multi-VLAN or subnet setups.
- **Roku OS 11.5+ Store Readiness (HTTP 403 Handling)**:
  - Proactively verifies `POST /keypress/` permissions during pairing (`verify_device.html`) and during device runtime.
  - When HTTP `403 Forbidden` is returned, displays the exact instruction:
    > `Enable Settings → System → Advanced system settings → Control by mobile apps → Permissive`

## Implemented ECP Endpoints

- `GET /query/device-info`: Parses `<serial-number>` (used as Homey `data.id`), `<friendly-device-name>`, `<power-mode>` (`PowerOn` vs `DisplayOff` for `onoff` state), and `<is-tv>`.
- `GET /query/apps`: Parses all installed apps and their `<app id="...">` attributes.
- `GET /query/active-app`: Parses the currently running app name and ID.
- `POST /keypress/<key>`: Sends remote commands (`PowerOn`, `PowerOff`, `Home`, `Up`, `Down`, `Left`, `Right`, `Select`, `Back`, `Play`, `Rev`, `Fwd`, `VolumeUp`, `VolumeDown`, `VolumeMute`, `ChannelUp`, `ChannelDown`, `InputHDMI1`–`InputHDMI4`, etc.).
- `POST /launch/<appId>`: Directly launches an installed Roku channel by ID.

## Flow Cards

- **Triggers**:
  - **Active app changed (`app_changed`)**: Fires with `app_name` and `app_id` tokens whenever the active channel changes.
  - **Turned on / Turned off**: Provided natively by Homey's `onoff` capability.
- **Conditions**:
  - **App is / isn't running (`app_is_running`)**: Dynamic autocomplete dropdown populated from `GET /query/apps`.
- **Actions**:
  - **Launch app (`launch_app`)**: Dynamic autocomplete dropdown populated from `GET /query/apps`.
  - **Send remote key (`send_remote_key`)**: Dropdown of all Roku ECP remote keys.
  - **Switch HDMI input (`switch_hdmi_input`)**: Switches between `InputHDMI1`–`InputHDMI4` on Roku TVs.

## Development

```bash
# Type-check and compile TypeScript to .homeybuild/
npm run build

# Run unit tests for ECP XML parsers, endpoints, and HTTP 403 handling
npm test
```
