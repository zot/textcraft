# Textcraft Project Index

> **Project Type:** Peer-to-peer text-based MUD (Multi-User Dungeon) game engine
> **Tech Stack:** TypeScript/JavaScript frontend + Go backend + libp2p networking
> **License:** MIT (Copyright 2020 Bill Burdick)
> **Status:** Active development - recent msgpack protocol upgrade & NAT improvements

---

## Documentation

### Core Documentation
- **README.md** - Project overview, pitch, and technology stack summary
- **html/README.md** (26KB) - Comprehensive user & developer guide
  - Complete command reference (70+ commands)
  - Format string system
  - Event/Descripton architecture
  - Extension development guide
  - Four levels of MUD building
  - Installation & setup instructions

### Architecture & Design
- **architecture.md** - Thing model architecture and capabilities
  - 9 core Thing features
  - Association system (one-to-one, many-to-one, many-to-many)
  - Standard rooms & prototypes
  - References system

- **mudcontrol.md** (27KB) - Protocol specification and implementation
  - Message structure (msgpack-based)
  - MUD control layer
  - Command execution flow

### Development & Planning
- **TODO.md** - Feature roadmap and planned enhancements
  - QuestItem system
  - Ownership improvements
  - Security features (key signing, private messages)
  - UI/UX enhancements

- **personalItems.md** - Personal/owned item mechanics
  - Generator system
  - Ownership patterns
  - Per-user item creation

### Analysis
- **findings.md** - Implementation vs documentation analysis
  - Feature coverage assessment
  - Undocumented capabilities
  - Code quality review

---

## Source Code

### Frontend (html/js/*.ts)
All TypeScript files compile to .js with .js.map source maps

**Core Modules:**
- **textcraft.ts** - Main entry point, module initialization
- **app.ts** - Application state tracking (NAT, peer, role, relay, section states)
- **base.ts** - Core state trackers and observers
- **model.ts** (~2000 lines) - Thing model, data storage, associations, proxies
- **mudcontrol.ts** (~2500 lines) - Protocol layer, MUD connections, commands
- **peer.ts** - Peer abstraction layer (IPeer interface)
- **mudproto.ts** - Default IPeer implementation for P2P communication
- **gui.ts** (~1000 lines) - User interface display and interaction
- **protocol-shim.ts** - Protocol abstraction layer
- **storagecontrol.ts** - Storage operations
- **exampleExtension.ts** - Example custom extension template

### HTML & Assets
- **html/textcraft.html** - Main web application interface
- **html/about.html** - About page
- **html/README.html** - Generated documentation
- **html/css/textcraft.css** - Main stylesheet (~300 lines)

### External Libraries (html/js/)
- **js-yaml.js** / **js-yaml.min.js** - YAML parsing for MUD definitions
- **msgpack.min.js** - MessagePack serialization
- **LICENSE-msgpack** - MessagePack license file

### UI Assets (html/images/)
- **textcraft.png** - Main logo/screenshot
- **Gray_Light_Icon.svg** - Disconnected status indicator
- **Green_Light_Icon.svg** - Connected status indicator
- **Orange_Light_Icon.svg** - Connecting status indicator

---

## Example MUDs (html/examples/)

Ready-to-use example worlds demonstrating various features:

- **Purgatory.yaml** (~800 lines) - Main comprehensive example world
- **Mystic Lands.yaml** - Fantasy-themed world example
- **Functions.yaml** - Function and scripting examples
- **Key Example.yaml** - Key/lock system demonstration
- **Personal Things.yaml** - Personal item mechanics examples
- **Extension Example.yaml** - Extension development examples

---

## Configuration Files

### Build & Development
- **build** - Shell script for cross-platform builds
  - Compiles TypeScript (tsc) and lints (tslint)
  - Embeds HTML assets into Go binaries
  - Supports: linux64, linux32, windows, mac, all
  - Version management with timestamps
  - Optional Dropbox/remote push

- **tsconfig.json** - TypeScript compiler configuration
  - Target: esnext
  - Source maps enabled
  - Base URL: html/

- **tslint.json** - TypeScript linting rules
  - Extends tslint:recommended
  - Allows console output
  - Strict promise handling

### Version Control
- **.gitignore** - Git ignore patterns
  - Build outputs: /work, /textcraft*, executables
  - Personal data: /personal
  - Temporary files: *~, .#*

### License
- **LICENSE** - MIT License text

---

## Key Concepts

### Thing Model
Everything in Textcraft is a "Thing" with these capabilities:
1. Properties (key-value storage)
2. Container relationships (things contain things)
3. Links (directional connections)
4. Extensions (custom behavior via JavaScript)
5. Associations (flexible many-to-many relationships)
6. Events (descripton propagation system)
7. Visibility (show/hide mechanics)
8. Prototypes (inheritance-like cloning)
9. Persistence (automatic storage)

### State Tracking System
- **NAT State:** Unknown, Public, Private
- **Peer State:** 13 connection states (Disconnected, Connecting, Connected, etc.)
- **Role State:** None, Guest, Host
- **Relay State:** Idle, Pending, Hosting
- **Section State:** Connection, Mud, Profile, Storage

### Command System
70+ built-in commands including:
- **Basic:** look, inventory, get, drop, go, say, whisper
- **Building:** @create, @describe, @link, @set, @associate
- **Admin:** @destroy, @teleport, @js (JavaScript execution)
- **Templates:** Custom command definitions with format strings

### P2P Architecture
- Decentralized: users own their data
- libp2p networking stack
- libp2p-websocket for browser compatibility
- NAT traversal with relay support
- msgpack-based protocol

---

## Directory Structure

```
/home/deck/Vaults/local/work/textcraft/
├── README.md                      # Project overview
├── LICENSE                        # MIT license
├── architecture.md                # Thing model design
├── mudcontrol.md                  # Protocol specification
├── TODO.md                        # Development roadmap
├── personalItems.md               # Item ownership guide
├── findings.md                    # Implementation analysis
├── index.md                       # This file
├── build                          # Build script
├── tsconfig.json                  # TypeScript config
├── tslint.json                    # Linting config
├── .gitignore                     # Git ignore patterns
├── specs/                         # Specifications (empty)
└── html/                          # Frontend application
    ├── textcraft.html             # Main UI
    ├── about.html                 # About page
    ├── README.md                  # Comprehensive guide
    ├── README.html                # Generated docs
    ├── ts/                        # TypeScript source
    │   ├── textcraft.ts           # Entry point
    │   ├── app.ts                 # State management
    │   ├── base.ts                # Core state trackers
    │   ├── model.ts               # Thing model
    │   ├── mudcontrol.ts          # Protocol layer
    │   ├── peer.ts                # Peer abstraction (IPeer)
    │   ├── mudproto.ts            # Default IPeer implementation
    │   ├── gui.ts                 # UI layer
    │   ├── protocol-shim.ts       # Protocol abstraction
    │   ├── storagecontrol.ts      # Storage
    │   └── exampleExtension.ts    # Extension template
    ├── js/                        # Compiled JavaScript
    │   ├── js-yaml.js             # YAML parser
    │   ├── msgpack.min.js         # Serialization
    │   └── *.js, *.js.map         # Compiled outputs
    ├── css/
    │   └── textcraft.css          # Main stylesheet
    ├── images/
    │   ├── textcraft.png          # Logo
    │   └── *_Light_Icon.svg       # Status indicators
    └── examples/
        ├── Purgatory.yaml         # Main example
        ├── Mystic Lands.yaml      # Fantasy world
        ├── Functions.yaml         # Scripting examples
        ├── Key Example.yaml       # Lock/key demo
        ├── Personal Things.yaml   # Ownership demo
        └── Extension Example.yaml # Extension demo
```

---

## Recent Development Activity

Latest commits (most recent first):
1. **ce79c93** - treerequest, NAT indication
2. **03cd833** - cleaning up protocol
3. **2e54ec4** - checkpointing protocol switch to msgpack
4. **a0bdf55** - Game Jam Commit: versioning, packaging, authoring
5. **dafeff9** - fixes, better name matching, get-from, drop-into

Current branch: **master**

---

## Quick Start References

### For Users
1. Read **html/README.md** sections 1-4 (User Guide)
2. Try examples in **html/examples/Purgatory.yaml**
3. Learn commands from **html/README.md** Command Reference

### For World Builders
1. Study **architecture.md** for Thing model
2. Review **html/README.md** sections 5-7 (Building Guide)
3. Examine **html/examples/** for patterns
4. Reference **personalItems.md** for ownership

### For Developers
1. Review **architecture.md** + **mudcontrol.md** for design
2. Read **html/README.md** section 8 (Extensions)
3. Study **html/ts/model.ts** (Thing implementation)
4. Study **html/ts/mudcontrol.ts** (Protocol layer)
5. Study **html/ts/peer.ts** (IPeer abstraction - implement for custom networking)
6. Check **findings.md** for implementation notes
7. Use **build** script for compilation

### For Contributors
1. Check **TODO.md** for planned features
2. Review **tsconfig.json** and **tslint.json** for code standards
3. Study existing examples in **html/examples/**
4. Run `./build` to compile and test

---

*Last updated: 2025-10-18*