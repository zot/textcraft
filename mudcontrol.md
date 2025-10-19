# mudcontrol.ts - MUD Command & Control System

**File:** `html/ts/mudcontrol.ts`
**Lines:** ~3,282
**Purpose:** Core command processing, event system, and player connection management for the Textcraft MUD

---

## Overview

`mudcontrol.ts` is the heart of Textcraft's command execution and event propagation system. It implements:

1. **Command System** - All user commands and admin commands
2. **Event System** - Descriptons (event propagation)
3. **Connection Management** - Player sessions and output handling
4. **Format System** - Text formatting with variable substitution
5. **Patching System** - Per-viewer property overrides
6. **Visibility System** - Selective object visibility

---

## Key Exports

### Global State
```typescript
export const currentVersion = 2
export let connection: MudConnection        // Current active connection
export let activeWorld: World               // Currently loaded world
```

### Classes
- `Command` - Command metadata (help, admin flag, method name)
- `Descripton` - Event/action that propagates through the world
- `MoveDescripton extends Descripton` - Movement events with origin/destination
- `CommandContext` - Builder for chaining commands
- `MudConnection` - Player session with command execution

### Functions
- `initCommands()` - Initialize command registry
- `createConnection()` - Create new player connection
- `spliceConnection()` - Inject custom connection class
- Utility functions: `capitalize()`, `indent()`, `keywords()`, etc.

---

## Constants and Configuration

### Standard Associations
```typescript
const stdAssocsOrder = [
    'location',     // Where the thing is
    'linkOwner',    // Owner of this link
    'otherLink',    // Other end of link
    'destination',  // Synonym for otherLink
    'key',          // Keys that open locks
    'visibleTo',    // Viewers who can see this
    'hides',        // Things hidden from viewers
    'patch',        // Property overrides per viewer
    'patchFor',     // Viewers who see patches
]
```

### Reserved Properties
```typescript
const reservedProperties = new Set([
    '_id',          // Cannot change thing ID
    '_prototype',   // Use @reproto instead
    '_contents',    // Managed internally
    '__proto__',    // JavaScript internals
])
```

### Patterns
```typescript
wordAndQuotePat     // /("(?:[^"\\]|\\.)*")|\s+/
wordAndQuotePatWS   // /("(?:[^"\\]|\\.)*"|\s+)/
opPat               // /^[-+*/%^|&<>=]|==|!=|<=|>=|not$/
```

---

## Class: Command

Represents a command definition with metadata.

### Properties
```typescript
help: string[]          // [args, description, args2, desc2, ...]
admin: boolean          // Requires admin privileges
alt: string             // Alternate name (e.g., 'i' -> 'inventory')
alts: Command[]         // Commands that alias to this
minArgs: number         // Minimum argument count
name: string            // Command name
method: string          // Method name on MudConnection
```

### All Commands
The file defines ~50 commands in the `commands` Map:

**Basic Commands:**
- `help`, `login`, `look`, `examine`, `go`
- `inventory` (aliases: `i`, `inv`, `invent`)
- `say`, `whisper`, `act`, `gesture`
- `get`, `drop`

**Admin Commands (@-prefixed):**
- `@create`, `@copy`, `@toast`, `@reproto`
- `@set`, `@setnum`, `@setbool`, `@setbigint`, `@del`
- `@assoc`, `@addassoc`, `@delassoc`
- `@method`, `@call`, `@run`, `@js`
- `@if`, `@change`, `@dup`
- `@output`, `@echo`, `@fail`
- `@dump`, `@dumpinh`, `@commands`
- `@find`, `@move`, `@link`, `@patch`
- `@add`, `@remove`
- `@mute`, `@unmute`, `@quiet`, `@loud`
- `@admin`, `@as`
- `@info`, `@instances`
- `@redpill`, `@bluepill`
- `@start`, `@stop`, `@clock`
- `@delay`, `@exit`, `@continue`
- `@script`, `@use`
- `@edit`, `@recreate`, `@editcopy`

---

## Class: Descripton

A **descripton** is a particle of information representing an action/event that propagates through the MUD.

### Properties
```typescript
connection: MudConnection   // Connection that created this
source: Thing               // Thing that performed action
tick: number                // Tick number when created
event: string               // Event type (go, get, drop, etc.)
args: any[]                 // Event-specific parameters
failed: boolean             // Whether action failed
ignoreClosed: boolean       // Propagate through closed things
done: boolean               // Propagation complete
succeedHooks: Function[]    // Callbacks on success
failHooks: Function[]       // Callbacks on failure
failureFormat: string       // Format string for failure message
```

### Key Methods

#### `emit(thing, visitFunc, excludes?, visitLinks?)`
Start propagation from a thing, calling visitFunc for each thing reached.

#### `propagate(thing, visited, visitFunc, visitLinks)`
Recursive propagation:
1. Visit current thing
2. Visit contents (`refs.location`)
3. Visit links (`assocMany.linkOwner`)
4. Optionally visit through links to destinations
5. If not closed, propagate to location

#### `sendOutput(start, formatString, args, prefix?, context?)`
Output to all observers:
- For each connection: format and output message
- For non-players: trigger reactions

#### `emitFail(start, failFormat, args?, prefix?, context?)`
Emit failure:
- Mark descripton as failed
- Output formatted failure message
- Trigger fail hooks
- Throw error to halt execution

#### `fail()`
Mark descripton as failed and trigger fail hooks.

---

## Class: MoveDescripton

Specialized descripton for movement (go, get, drop).

### Additional Properties
```typescript
thing: Thing            // Thing being moved
origin: Thing           // Where it's coming from
destination: Thing      // Where it's going to
direction: Thing        // Direction/link used (if any)
directionString: string // Human-readable direction
enterFormat: string     // Message for destination
moveFormat: string      // Message for actor
exitFormat: string      // Message for origin
```

### Lifecycle
1. Create with actor, thing, destination, direction
2. Fire event interceptors (`event_go_*`)
3. If not failed, execute move
4. Send three outputs:
   - **moveFormat** to actor ("You go north")
   - **exitFormat** to origin ("Alice goes north")
   - **enterFormat** to destination ("Alice arrives from the south")

---

## Class: CommandContext

Builder pattern for creating and running command sequences.

### Methods

#### `cmd(...stringsAndThings)`
Append command, converting Things to `%ID` format.
```typescript
ctx.cmd('look at ', thing)  // "look at %42"
```

#### `cmdf(format, ...args)`
Append formatted command with `$0, $1, $2` substitution.
```typescript
ctx.cmdf('get $0 from $1', key, box)  // "get %17 from %23"
```

#### `run()`
Execute all accumulated commands.

### Usage
```javascript
// In @js or methods:
cmd('say Hello!').cmd('look').run()

// Chaining:
cmdf('get $0 from $1', item, container)
    .cmd('examine ', item)
    .run()
```

---

## Class: MudConnection

Represents a player's connection to the MUD with command execution context.

### Properties

#### State
```typescript
world: World                    // Current world
thing: Thing                    // Player's thing
user: string                    // Username
admin: boolean                  // Admin privileges
remote: boolean                 // Remote/headless connection
verboseNames: boolean           // Show thing IDs
```

#### Output Control
```typescript
outputHandler: (str) => void    // Where output goes
suppressOutput: boolean         // Temporarily disable output
muted: number                   // Mute counter
quiet: boolean                  // Quiet mode
failed: boolean                 // Last command failed
```

#### Context
```typescript
event: Descripton              // Current event being processed
conditionResult: any           // Last @if result (%result)
created: Thing[]               // Recently created things (%-1, %-2...)
commands: Map<string, Command> // Available commands
```

#### Patching & Visibility
```typescript
patches: Map<Thing, Thing>     // Cached patched things
patchCounts: Map<Thing, number> // Cache invalidation
hiddenThings: Map<Thing, Set<Thing>> // Hidden object cache
hiddenUpdate: number           // Cache version
```

#### Tick System
```typescript
tickCount: number              // Current tick
tickers: Set<Thing>            // Things with react_tick
ticking: boolean               // Clock running
stopClock: boolean             // Clock paused
```

#### Reaction System
```typescript
acted: Set<Thing>              // Things that acted this cycle
pendingReactions: Map<Thing, Function> // Delayed reactions
```

---

## MudConnection: Key Methods

### Connection Lifecycle

#### `init(world, outputHandler, remote?)`
Initialize connection with world and output handler.

#### `start(quiet?)`
Start session:
- Set up ticker watcher
- Initialize clock system
- Display welcome message
- Load world extensions

#### `close()`
Clean up:
- Move thing to Limbo
- Clear world reference
- Update state trackers

### Command Execution

#### `runCommands(commands: string[])`
Main command loop:
1. Parse command line
2. Check for shortcuts (`'`, `"`, `:`, `!`, `%`, `%%`)
3. Look up command
4. Parse arguments
5. Find things by name/reference
6. Invoke command method
7. Handle errors

#### `runText(line: string)`
Parse and run single command line.

#### `runTextList(lines: string[])`
Run multiple commands, handling indentation for `@script`.

### Output & Formatting

#### `output(text: string)`
Send text to output handler if not suppressed/muted.

#### `error(text: string)`
Output error message (always visible, even when muted).

#### `basicFormat(thing, formatString, args)`
Process format string with substitutions:

**Format Codes:**
- `$quote` - Disable further formatting
- `$this` - Formatted name ("you" if player)
- `$name` - Thing's name
- `$is` - "is" or "are" (plurality)
- `$s` - Optional "s" for plurality
- `$location`, `$owner`, `$link` - Associations
- `$contents`, `$links` - Lists
- `$forme` - Text for actor only
- `$forothers` - Text for observers
- `$arg`, `$arg1-N` - Format arguments
- `$result`, `$result.prop` - Conditional result
- `$event`, `$event.prop` - Current descripton
- `$admin` - Admin-only text

#### `formatName(thing, escape?, verbose?, simpleName?)`
Format thing name with optional ID and escaping.

### Patching System

#### `props(thing)`
Get patched version of thing for current viewer.

#### `findPatch(thing)`
Check if thing has a patch for this viewer.

#### `makePatch(patchProto, thing)`
Create proxy that overlays patch properties on thing.

**How Patching Works:**
1. Thing A has `patch` association to Patch P
2. Patch P has `patchFor` association to Player B
3. When Player B views Thing A, they see P's properties overlaid
4. Other players see Thing A normally

**Example:**
```javascript
// Door appears locked to player, open to admin
@create thing door
@create thing doorPatch
@set doorPatch description "The door is locked"
@assoc doorPatch patch door
@assoc doorPatch patchFor player
// Player sees "locked", admin sees normal door
```

### Visibility System

#### `isVisible(thing, fromThing?)`
Check if thing is visible considering:
- `hidden` property
- `visibleTo` associations
- `hides` associations (things that hide other things)

#### `getHiddenThings(thing)`
Get set of things hidden from this viewer.

### Thing Lookup

#### `find(nameOrPath, start?, type?)`
Find thing by name from starting location:
- Search nearby things
- Check aliases
- Handle special references (`me`, `here`, `%123`, `%-1`)
- Support paths (`thing.location.prototype`)

#### `findNearby(thing?)`
Get all things perceivable from location.

### Event System

#### `react(thing, descripton)`
Process reaction:
1. Find matching `react_EVENT` or `!react_EVENT`
2. Execute template or call method
3. Track acted things to avoid duplicates

#### `checkTicker(thing)`
If thing has `_react_tick`, add to ticker set.

#### `queueTick()`
Schedule next tick event (uses clock rate).

### Event Interception

#### `eventCommand(eventProp, stage, thing, evt)`
Fire event interceptor:
- `event_go_thing` - thing being moved
- `event_go_direction` - direction/link used
- `event_go_origin` - leaving location
- `event_go_destination` - entering location

Interceptors can call `@fail` to prevent the action.

#### `continueMove(cmdInfo, evt)`
Continue move if not failed, firing next stage interceptors.

---

## Command Implementations

### Basic Commands

#### `help(cmdInfo, cmd?)`
Display help for command or all commands.

#### `look(cmdInfo, target?)`
Examine location or thing:
- Use `description` property
- Show contents and links
- Format with `examineFormat`

#### `go(cmdInfo, directionStr)`
Move to location or through link:
1. Find direction/destination
2. Check if link is locked
3. Fire `event_go` interceptors
4. Execute move
5. Send move, exit, enter messages
6. Automatically look at new location

#### `get(cmdInfo)`
Pick up thing:
1. Parse "get X" or "get X from Y"
2. Check `event_get` interceptors
3. Move to inventory
4. Send move messages

#### `drop(cmdInfo)`
Drop thing:
1. Parse "drop X" or "drop X into Y"
2. Check `event_drop` interceptors
3. Move to location or container
4. Send move messages

#### `inventory(cmdInfo)`
List contents of player's thing.

#### `say(cmdInfo)`
Speak to everyone nearby:
- Emit `say` descripton
- Format: "You say: ..." / "Alice says: ..."

#### `whisper(cmdInfo)`
Speak to specific thing (private message).

#### `act(cmdInfo)` / `gesture(cmdInfo)`
Perform action:
- `act smile` → "You smile" / "Alice smiles"
- `gesture bob wave` → "You wave at Bob" / "Alice waves at Bob"

### Admin Commands

#### `atCreate(cmdInfo, protoStr, name)`
Create new thing:
1. Find prototype
2. Create instance with name
3. Set description if provided
4. Move to inventory
5. Add to created list (for `%-1`)

#### `atCopy(cmdInfo)`
Copy thing and connected graph.

#### `atToast(cmdInfo)`
Delete things and everything connected.

#### `atMove(cmdInfo)`
Move thing to new location.

#### `atLink(cmdInfo)`
Create bidirectional links:
```
@link north here south room  // Creates paired links
```

#### `atSet(cmdInfo)`
Set property on thing:
- Parse thing, property, value
- Handle special properties (location, linkOwner, etc.)
- Support command templates and methods
- Validate reserved properties

#### `atAssoc(cmdInfo, thingStr, prop, otherStr)`
Set association (replaces existing).

#### `atAddassoc(cmdInfo, thingStr, prop, otherStr)`
Add association (many-to-many).

#### `atDelassoc(cmdInfo, thingStr, prop, otherStr?)`
Remove association(s).

#### `atReproto(cmdInfo)`
Change thing's prototype.

#### `atMethod(cmdInfo)`
Define method on thing:
```
@method box react_go (actor, from, to) cmd('say Hello!')
```

#### `atCall(cmdInfo)`
Call method with arguments:
```
@call box.sayHello player
```

#### `atRun(cmdInfo)`
Execute command template property:
```
@run key generate
```

#### `atJs(cmdInfo)`
Execute JavaScript code:
- Parse variable bindings
- Bind to specProxies
- Provide helpers (me, here, cmd, cmdf, etc.)
- Return result

#### `atIf(cmdInfo)`
Conditional execution:
```
@if box gold = 100 @then say You win!
@if player health < 50 @then heal player
```

#### `atChange(cmdInfo)`
Arithmetic operations:
```
@change player gold + 10
@change monster health - damage
```

#### `atDup(cmdInfo)`
Copy property value:
```
@dup newThing description oldThing description
```

#### `atOutput(cmdInfo)` / `atEcho(cmdInfo)`
Output formatted text with optional descripton emission.

#### `atFail(cmdInfo)`
Fail current event with message.

#### `atDump(cmdInfo)` / `atDumpinh(cmdInfo)`
Display thing properties (with/without inherited).

#### `atCommands(cmdInfo)` / `atEdit(cmdInfo)` / `atRecreate(cmdInfo)` / `atEditcopy(cmdInfo)`
Generate command scripts to recreate things.

#### `atFind(cmdInfo)`
Search for things by name.

#### `atInfo(cmdInfo)`
Display world information.

#### `atInstances(cmdInfo)`
List all instances of prototype.

#### `atAs(cmdInfo)`
Execute command as another thing.

#### `atPatch(cmdInfo)`
Create property patch for viewer.

#### `atAdd(cmdInfo)` / `atRemove(cmdInfo)`
Add/remove from list properties.

#### `atAdmin(cmdInfo)`
Grant/revoke admin privileges.

#### `atRedpill(cmdInfo)` / `atBluepill(cmdInfo)`
Toggle verbose names (show thing IDs).

#### `atMute(cmdInfo)` / `atUnmute(cmdInfo)`
Suppress/enable output from other users.

#### `atQuiet(cmdInfo)` / `atLoud(cmdInfo)`
Suppress/enable all output for current command.

#### `atStart(cmdInfo)` / `atStop(cmdInfo)` / `atClock(cmdInfo)`
Control tick clock.

#### `atDelay(cmdInfo)`
Queue command to run after current batch.

#### `atExit(cmdInfo)`
Stop processing command list.

#### `atContinue(cmdInfo)`
Continue processing (after @fail in event interceptor).

#### `atScript(cmdInfo)`
Parse multi-line indented script.

#### `atUse(cmdInfo)`
Push things onto created list for `%-N` references.

---

## Thing Reference Syntax

The system supports multiple ways to reference things:

### Direct References
- `me` - Your thing
- `here` - Your location
- `out` - Location's location (if in container)

### Standard Rooms
- `%lobby` - The Lobby
- `%limbo` - Limbo
- `%protos` - Hall of Prototypes

### By ID
- `%123` - Thing with ID 123
- `%-1` - Last created thing
- `%-2` - Second-to-last created thing
- `%proto:room` - Prototype by name

### Special References
- `%result` - Result of last @if condition
- `%result.property` - Property of result
- `%event` - Current descripton
- `%event.source` - Thing that emitted descripton

### Paths
- `thing.assoc.location` - Traverse associations
- `player.inventory.count` - Access nested properties

### Synonyms
- `%NAME` - Same as `NAME` (for convenience)

---

## Event Interception System

Events can be intercepted at multiple stages:

### Stage Properties

#### Movement (`go`)
- `event_go` - Any stage
- `event_go_thing` - Moving this thing
- `event_go_direction` - Using this as direction
- `event_go_origin` - Leaving this location
- `event_go_destination` - Entering this location

#### Getting (`get`)
- `event_get` - Any stage
- `event_get_thing` - Getting this thing
- `event_get_origin` - Getting from this location
- `event_get_destination` - This thing receiving items

#### Dropping (`drop`)
- `event_drop` - Any stage
- `event_drop_thing` - Dropping this thing
- `event_drop_origin` - This thing dropping items
- `event_drop_destination` - Dropping into this location

### Interceptor Behavior
- Can be command template or method
- Method takes precedence over template
- Can call `@fail` to prevent action
- Can call `@continue` to allow action
- Can modify descripton properties

### Example: Locked Door
```javascript
// Door intercepts movement
@method door event_go_direction () {
    if (!inAny('key', this.thing)) {
        event.emitFail(me, "$forme You need a key! $forothers $actor tries the door but it's locked")
    }
}
```

---

## Reaction System

Things can react to descriptons after they propagate:

### Reaction Methods
- `react_go` - React to movement
- `react_get` - React to getting things
- `react_drop` - React to dropping things
- `react_say` - React to speech
- `react_act` - React to actions
- `react_tick` - React to clock ticks
- `react_EVENT` - React to custom events

### Reaction Context
Methods have access to:
- `this.thing` - The thing reacting
- `this.event` - The descripton
- `me` - specProxy for thing
- `here` - specProxy for location
- `cmd()`, `cmdf()` - Command builders

### Example: Friendly NPC
```javascript
@method guard react_go (actor, from, to) {
    if (this.thing.isIn(to)) {
        cmd('say Welcome, stranger!')
    }
}
```

---

## Tick System

The clock system fires periodic `tick` events:

### Setup
1. Set `react_tick` on thing (template or method)
2. Thing automatically added to tickers set
3. Clock fires every N seconds (default 2)

### Tick Descripton
```javascript
{
    event: 'tick',
    source: thing,
    tick: 42,
    failed: false
}
```

### Example: Healing Over Time
```javascript
@method player react_tick () {
    const health = this.thing.health || 100
    if (health < 100) {
        this.thing.health = Math.min(100, health + 5)
        cmd('say You feel better')
    }
}
```

### Clock Control
- `@start` - Start clock
- `@stop` - Pause clock
- `@clock seconds` - Set tick rate

---

## Format String System

Format strings provide dynamic text generation:

### Context Types

#### `$forme` / `$forothers`
Split message for actor vs observers:
```
"$forme You open the door $forothers $actor opens the door"
```
- Actor sees: "You open the door"
- Others see: "Alice opens the door"

#### `$admin`
Admin-only content:
```
"This is a door $admin (id: $this.id)"
```

### Substitution Codes

#### Thing Properties
- `$this` - Formatted name or "you"
- `$name` - Raw name
- `$is` - "is" or "are"
- `$s` - Optional "s" for plurality

#### Associations
- `$location` - Thing's location
- `$owner` - Link's owner
- `$link` - Link's destination
- `$contents` - List of contents
- `$links` - List of links

#### Arguments
- `$arg` or `$arg1` - First argument
- `$arg2`, `$arg3`, ... - Subsequent arguments

#### Context
- `$result` - Last @if result
- `$result.prop` - Property of result
- `$event` - Current descripton
- `$event.prop` - Descripton property

#### Control
- `$quote` - Stop further formatting

### Formatting Functions

#### `formatContexts(str)`
Split string into `me` and `others` parts.

#### `basicFormat(thing, formatString, args)`
Process all substitutions and return result.

#### `formatList(things, formatter)`
Format array of things as comma-separated list.

---

## Utility Functions

### String Processing

#### `capitalize(str, templateWord?)`
Capitalize first letter, preserving format codes.

#### `indent(spaceCount, str)`
Add indentation to each line.

#### `trimIndents(str)`
Remove common leading whitespace.

#### `keywords(str, ...keywords)`
Parse keywords from string.

### Connection Management

#### `createConnection(world, outputHandler, remote?)`
Create new MudConnection.

#### `spliceConnection<T>(constructor)`
Replace MudConnection class with custom subclass.

#### `quit()`
Close current connection.

#### `removeRemotes()`
Close all remote connections.

#### `myThing()`
Get current player's thing.

### Thing Utilities

#### `pxyThing(tip)`
Unwrap thing from proxy/ID/wrapper.

#### `pxyThings(tips)`
Unwrap array of things.

---

## Architecture Patterns

### Command Dispatch
1. Parse command line
2. Lookup in commands Map
3. Convert to method name (`@create` → `atCreate`)
4. Parse arguments
5. Resolve thing references
6. Call method on MudConnection

### Event Propagation
1. Create Descripton
2. Fire interceptors (event_*)
3. Execute action if not failed
4. Propagate to nearby things
5. Trigger reactions (react_*)
6. Format and output messages

### Caching Strategy
- Patches cached with world.count invalidation
- Hidden things cached with update counter
- Thing lookups use World.thingCache

### Error Handling
- Command errors caught and displayed
- Failed descriptons prevent action
- Transaction rollback on errors
- Stack traces for debugging

---

## Peer Abstraction Layer

### IPeer Interface

The application uses the `peer.ts` module which defines the `IPeer` interface for peer-to-peer networking. This abstraction allows different networking implementations to be swapped in without changing the rest of the application.

**File:** `html/ts/peer.ts`

#### Interface Definition
```typescript
interface IPeer {
  currentVersionID: string
  versionID: string

  reset(): void
  relayConnectString(): string
  startHosting(): void
  joinSession(session: string): void
  startRelay(): void
  hostViaRelay(): void
  userThingChanged(thing: Thing): void
  command(cmd: string): void
}
```

#### Default Implementation
- **mudproto.ts** - Default P2P implementation using libp2p
  - Handles peer discovery and connection
  - Manages relay connections for NAT traversal
  - Synchronizes world state between peers
  - Broadcasts commands to connected peers

#### Custom Implementations
To implement a custom networking layer:

1. Create a class implementing `IPeer`
2. Implement all required methods and properties
3. Set `peer.current` to an instance of your implementation
4. The rest of the application will use your implementation

**Example:**
```typescript
import { IPeer } from './peer'

class MyCustomPeer implements IPeer {
  currentVersionID: string = "1.0"
  versionID: string = "1.0"

  reset(): void { /* your implementation */ }
  relayConnectString(): string { /* your implementation */ }
  // ... implement other methods
}

// Replace the peer implementation
import * as peer from './peer'
peer.current = new MyCustomPeer()
```

#### Usage in Application
The application accesses peer functionality through `peer.current`:
```typescript
import * as peer from './peer'

// Call peer methods
peer.current.startHosting()
peer.current.joinSession(sessionId)
peer.current.command(commandString)

// Access properties
const version = peer.current.versionID
```

---

## Integration Points

### With model.ts
- Uses `World`, `Thing`, `thingId` types
- Calls thing methods and property accessors
- Triggers world transactions

### With base.ts
- Uses state trackers (mudTracker, roleTracker, peerTracker)
- Sets MudState during lifecycle

### With peer.ts (IPeer interface)
- Peer abstraction layer for network communication
- mudproto.ts provides the default IPeer implementation
- IPeer can be replaced with alternative networking implementations
- Remote command execution via peer interface

### With gui.ts
- Provides output handler callback
- Receives formatted HTML output

---

## Design Philosophy

### Composition Over Inheritance
- Things composed of properties, associations, methods
- Behavior added dynamically via templates/methods
- No rigid class hierarchy

### Event-Driven
- All actions emit descriptons
- Loose coupling via propagation
- Objects react independently

### Meta-Programming
- `@js` for arbitrary code execution
- `@method` for dynamic method creation
- Command templates for DSL extension

### User-Friendliness
- Natural language commands
- Forgiving parsing
- Rich error messages
- Inline help

---

## Security Considerations

### Admin Protection
- Admin-only commands checked
- Property modification restricted
- Sensitive operations require privileges

### Reserved Properties
- Core properties cannot be overwritten
- Prototype chain protected
- Association integrity maintained

### Code Execution
- `@js` and `@method` admin-only
- Sandboxed execution context
- No direct file system access

### Remote Connections
- Separate permissions model
- Output filtering
- Limited command set

---

## Performance Optimizations

### Caching
- Patched thing proxies cached
- Hidden thing sets cached
- Association lookups indexed

### Lazy Evaluation
- Format strings parsed on demand
- Thing lookups deferred
- Associations loaded as needed

### Batch Processing
- Multiple commands in single transaction
- Delayed reactions queued
- Output buffering

---

## Extension Points

### Custom Commands
Add to `commands` Map before `initCommands()`.

### Custom Connection Class
```typescript
class MyConnection extends MudConnection {
    // Override methods
}
spliceConnection(MyConnection)
```

### Custom Descriptons
Subclass `Descripton` for new event types.

### Format Codes
Extend `basicFormat()` for new substitutions.

---

## Common Patterns

### Creating Objects
```javascript
@create proto name description
@set %-1 property value
@assoc %-1 location here
```

### Custom Commands
```javascript
@set sword cmd attack "@run me attack"
@method me attack () {
    const damage = Math.random() * 10
    cmdf('say I attack for $0 damage!', damage).run()
}
```

### Locked Doors
```javascript
@create link door
@set door locked true
@create generator keys
@add keys key door
@set door event_go_direction "@if %event.actor key = door @then @continue @else @fail door 'Locked!'"
```

### Reactive Objects
```javascript
@method box react_tick () {
    if (this.thing.gold > 100) {
        cmd('say The box overflows with gold!')
    }
}
```

### Patching for Illusions
```javascript
@create thing fake-wall
@set fake-wall description "A solid stone wall"
@create thing wall-patch
@set wall-patch description "A shimmering illusion"
@assoc wall-patch patch fake-wall
@assoc wall-patch patchFor wizard
// Wizard sees illusion, others see wall
```

---

## File Statistics

- **Total Lines:** ~3,282
- **Exports:** 11 major items
- **Classes:** 4 (Command, Descripton, MoveDescripton, MudConnection, CommandContext)
- **Commands:** ~50 user and admin commands
- **Command Methods:** ~55 implementations
- **Key Patterns:** ~5 regex patterns
- **State Variables:** ~15 in MudConnection

---

## Summary

`mudcontrol.ts` is the execution engine of Textcraft, handling everything from simple "look" commands to complex JavaScript execution and event propagation. Its architecture enables:

- **Flexible command system** with aliases and shortcuts
- **Rich event system** with interception and reaction
- **Dynamic behavior** via templates and methods
- **Per-viewer customization** via patching
- **Selective visibility** for hidden objects
- **Extensibility** through custom commands and connection classes

The file exemplifies functional programming patterns (immutability, pure functions) combined with object-oriented design (classes, inheritance) to create a powerful and flexible MUD engine.
