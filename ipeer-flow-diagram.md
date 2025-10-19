# IPeer Flow Diagram

This diagram shows how the IPeer abstraction is used throughout the Textcraft application, from initialization through various user interactions and P2P operations.

## Application Architecture with IPeer

```mermaid
flowchart TD
    %% Initialization
    Start([Browser loads textcraft.html]) --> OnLoad[window.onload]
    OnLoad --> InitModules[Initialize all modules<br/>textcraft.ts]
    InitModules --> InitPeer[mudproto.ts calls setCurrent<br/>registers MudProtoPeer implementation]
    InitPeer --> OpenStorage[Model.openStorage]
    OpenStorage --> GuiStart[Gui.start]
    GuiStart --> PeerStart[peer.start<br/>MudStorage]
    PeerStart --> Ready([App Ready])

    %% User interactions
    Ready --> UserChoice{User Action}

    %% Host path
    UserChoice -->|Click 'Host'| HostBtn[GUI: #mud-host button]
    HostBtn --> StartHost[peer.startHosting]
    StartHost --> BecomeHost[Strategy: HostStrategy<br/>Load/create MUD world]
    BecomeHost --> ShowConnStr[Display connection string]
    ShowConnStr --> HostLoop{User actions<br/>while hosting}

    %% Guest path
    UserChoice -->|Click 'Join'| GuestBtn[GUI: #connect button]
    GuestBtn --> JoinInput[User enters host connection string]
    JoinInput --> JoinSession[peer.joinSession<br/>session string]
    JoinSession --> BecomeGuest[Strategy: GuestStrategy<br/>Connect to host]
    BecomeGuest --> GuestLogin[Login to MUD]
    GuestLogin --> GuestLoop{User actions<br/>while guest}

    %% Relay path
    UserChoice -->|Click 'Relay'| RelayBtn[GUI: #mud-select-relay button]
    RelayBtn --> StartRelayOp[peer.startRelay]
    StartRelayOp --> BecomeRelay[Strategy: RelayStrategy<br/>Forward traffic]
    BecomeRelay --> RelayLoop{Relay running}

    %% Host via Relay path
    UserChoice -->|Click 'Host via Relay'| RelayHostBtn[GUI: #host-with-relay button]
    RelayHostBtn --> RelayHostInput[User enters relay connection string]
    RelayHostInput --> HostViaRelay[peer.hostViaRelay<br/>sessionID]
    HostViaRelay --> BecomeRelayHost[Strategy: RelayHostStrategy<br/>Host behind NAT]
    BecomeRelayHost --> HostLoop

    %% Host operations
    HostLoop -->|Guest changes name| NameChange[mudcontrol.ts detects<br/>thing.name changed]
    NameChange --> UserThingChanged[peer.userThingChanged<br/>thing]
    UserThingChanged --> UpdateUserMap[Update internal UserInfo map]
    UpdateUserMap --> BroadcastSetUser[Broadcast 'setUser' command<br/>to all guests]
    BroadcastSetUser --> HostLoop

    HostLoop -->|Guest sends command| GuestCmd[Receive command from guest]
    GuestCmd --> RouteToMud[Route to guest's MudControl]
    RouteToMud --> ExecuteHost[Execute in MUD world]
    ExecuteHost --> SendResult[Send result to guest]
    SendResult --> HostLoop

    %% Guest operations
    GuestLoop -->|User types command| InputCmd[mudcontrol.ts receives input]
    InputCmd --> PeerCommand[peer.command<br/>cmd text]
    PeerCommand --> SendToHost[Send to host via P2P]
    SendToHost --> WaitResult[Wait for response]
    WaitResult --> DisplayOutput[gui.ts displays output]
    DisplayOutput --> GuestLoop

    GuestLoop -->|Name changed locally| GuestNameChange[mudcontrol.ts: thing.name changed]
    GuestNameChange --> GuestUserThingChanged[peer.userThingChanged<br/>thing]
    GuestUserThingChanged --> SendNameToHost[Send to host<br/>host propagates to others]
    SendNameToHost --> GuestLoop

    %% Quit/Reset
    HostLoop -->|Click 'Quit'| Quit[GUI: #mud-quit button]
    GuestLoop -->|Click 'Quit'| Quit
    RelayLoop -->|Click 'Stop'| Quit
    Quit --> PeerReset[peer.reset]
    PeerReset --> Disconnect[Disconnect all peers<br/>Clear network state]
    Disconnect --> MudQuit[mudcontrol.quit]
    MudQuit --> Ready

    %% Version checking
    Ready -.->|GUI polls| CheckVersion{peer.currentVersionID<br/>vs peer.versionID}
    CheckVersion -.->|Mismatch| ShowUpdate[Show update notification]
    CheckVersion -.->|Match| HideUpdate[Hide update notification]

    style Start fill:#e1f5ff
    style Ready fill:#d4edda
    style BecomeHost fill:#fff3cd
    style BecomeGuest fill:#fff3cd
    style BecomeRelay fill:#fff3cd
    style BecomeRelayHost fill:#fff3cd
    style UserThingChanged fill:#ffd6d6
    style PeerCommand fill:#ffd6d6
```

## Key IPeer Usage Patterns

### 1. Initialization Flow
```
textcraft.ts (entry point)
    ↓
mudproto.ts: setCurrent(MudProtoPeer)
    ↓
peer.current = MudProtoPeer instance
    ↓
All modules can now: import {current as peer} from './peer'
```

### 2. Module Import Pattern
```typescript
// In gui.ts, mudcontrol.ts, etc.
import {current as peer} from './peer'

// Then use directly:
peer.startHosting()
peer.command("look")
peer.userThingChanged(thing)
```

### 3. Host Workflow
```
User clicks "Host" button
    ↓
gui.ts: peer.startHosting()
    ↓
mudproto.ts: Creates HostStrategy
    ↓
Loads MUD from storage OR creates new world
    ↓
Displays connection string to GUI
    ↓
Listens for guest connections
    ↓
When guest connects:
  - Creates MudControl for guest
  - Syncs world state
  - Routes commands bidirectionally
```

### 4. Guest Workflow
```
User clicks "Join" → enters connection string
    ↓
gui.ts: peer.joinSession(connectionString)
    ↓
mudproto.ts: Creates GuestStrategy
    ↓
Connects to host via libp2p
    ↓
Login process (name selection)
    ↓
mudcontrol.ts: All commands go through peer.command()
    ↓
Commands sent to host → executed → results returned
```

### 5. User Synchronization (userThingChanged)
```
mudcontrol.ts detects: this.thing.name !== this.myName
    ↓
peer.userThingChanged(this.thing)
    ↓
mudproto.ts (host only):
  - Looks up peerID for thing
  - Updates UserInfo map: {peerID, newName}
  - Creates 'setUser' command
  - Broadcasts to all guests
  - (Relay mode: also sends to relay server)
    ↓
All peers now see updated username
```

### 6. Command Routing
```
Guest:
  User input → mudcontrol.ts → peer.command(text)
    → Send to host over P2P
    → Host executes
    → Result sent back
    → gui.ts displays

Host:
  Command arrives from guest
    → peer routes to correct guest's MudControl
    → Executes in shared world
    → Results sent to affected peers
```

## State Diagram: Peer Lifecycle

```mermaid
stateDiagram-v2
    [*] --> Empty: App starts
    Empty --> Ready: setCurrent(MudProtoPeer)<br/>peer.start(storage)

    Ready --> Host: peer.startHosting()
    Ready --> Guest: peer.joinSession(string)
    Ready --> Relay: peer.startRelay()
    Ready --> RelayHost: peer.hostViaRelay(sessionID)

    Host --> Hosting: Strategy = HostStrategy
    Guest --> Connected: Strategy = GuestStrategy
    Relay --> Relaying: Strategy = RelayStrategy
    RelayHost --> HostingViaRelay: Strategy = RelayHostStrategy

    Hosting --> Ready: peer.reset()
    Connected --> Ready: peer.reset()
    Relaying --> Ready: peer.reset()
    HostingViaRelay --> Ready: peer.reset()

    Hosting --> Hosting: peer.userThingChanged()<br/>peer.command()
    Connected --> Connected: peer.command()
    HostingViaRelay --> HostingViaRelay: peer.userThingChanged()<br/>peer.command()
```

## IPeer Interface Methods - Usage Matrix

| Method | GUI | MudControl | MudProto | Purpose |
|--------|-----|------------|----------|---------|
| `currentVersionID` | ✓ | | ✓ | Version checking for updates |
| `versionID` | ✓ | | ✓ | Expected version comparison |
| `init()` | | | ✓ | App initialization |
| `start()` | | | ✓ | Network startup |
| `reset()` | ✓ | ✓ | | Disconnect & cleanup |
| `connectString()` | ✓ | | ✓ | Show to user for sharing |
| `relayConnectString()` | ✓ | | ✓ | Show for relay connections |
| `startHosting()` | ✓ | | | User clicks "Host" |
| `joinSession()` | ✓ | | | User clicks "Join" |
| `startRelay()` | ✓ | | | User clicks "Relay" |
| `hostViaRelay()` | ✓ | | | User requests relay hosting |
| `userThingChanged()` | | ✓ | | Name changes propagation |
| `command()` | | ✓ | | All MUD command execution |

## Files Involved

- **peer.ts** - IPeer interface definition, singleton export
- **mudproto.ts** - MudProtoPeer implementation, strategies
- **gui.ts** - UI buttons trigger peer operations, version display
- **mudcontrol.ts** - Command routing, user sync via peer
- **textcraft.ts** - Initialization orchestration
- **protocol-shim.ts** - Underlying libp2p abstraction

---

*Generated: 2025-10-18*
