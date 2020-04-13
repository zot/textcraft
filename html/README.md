![Textcraft MUD](images/textcraft.png "Textcraft MUD")

# TEXTCRAFT

Textcraft is an oldskool text-based MUD with a twist -- it's peer-to-peer.

There are no servers. YOU own your data.

It relies on [libp2p](https://github.com/libp2p/go-libp2p) for peer-to-peer networking and uses [libp2p-websocket](https://github.com/zot/libp2p-websocket) to connect browsers to libp2p.

# MIT LICENSE

The MIT license is [here](LICENSE)

# Using the MUD

1. Start by creating or uploading a MUD (using the Create or Upload buttons)
1. Activate the MUD, your default user should have admin privileges
1. A new MUD will start you in the lobby
1. Create a room: `@create room The Dark Forest`
1. Link it to your current room: `@link here north south %-1` -- `%-1` refers to the last created thing
1. Lock the north exit: `@set north locked true`
1. Create a key generator: `@create generator a pile of keys`
1. Fix up the name of the generator: `@set %-1 name key`
1. Add the exit to the keys property on the key: `@add key keys north`
1. Drop the key generator so other people can get it: `drop key`
1. Try going north: `north`
1. Pick up a key: `get key` -- this actually copies the generator key
1. Really go north: `north`
1. Toast your key copy: `@toast key`
1. Go south (south isn't locked -- you could lock it and add it to the key generator)
1. Try going north

## Example MUDs

Shift-click or right-click and choose "Save link as..." to save these to your disk

* <a href='javascript:window.textcraft ? textcraft.Gui.activateMudFromURL("examples/Key%20Example.yaml") : document.location = "examples/Key%20Example.yaml"'>Key and Lock</a>
* <a href='javascript:window.textcraft ? textcraft.Gui.activateMudFromURL("examples/Extension%20Example.yaml") : document.location = "examples/Extension%20Example.yaml"'>Simple Extension</a>

## Creating things

When you create something with @create, you need a prototype, like this: `@create thing stone`

You can see a list of prototypes with the `@info` command.

You can list any prototype with `%proto:NAME`, like this: `@dump %proto:room`

## Format strings

Various commands like `output` and `look` use format strings with special codes that start with $ in properties like description or examineFormat. Commands like look print a format string with arguments (look uses the description property).

Some format string properties:

* description     -- Used when someone looks at the object
* contentsFormat  -- Used when displaying this thing as part of the contents of its location
* examineFormat   -- Used by the examine command and the look command for your location or yourself

Use the help command and check out the documentation for @set for more info on the properties

Some format codes:

* $forme ...      -- Use the text after $forme when it is outputting to the user
* $forothers ...  -- Use the text after $forothers if it is outputting to users other than the actor
* $actor          -- The formated name of the thing running the command
* $thing          -- The current thing (like the object you're looking at in a look command)
* $arg            -- The first format argument ($arg1 also works)
* $arg2           -- The second format argument

Use the help command and check out the format string documentation for more info.

## Command templates

An object can add or enhance commands if it contains a command property and a) the user is holding it, b) it is the user's location, or c) it is a link on the user's location.

Command properties:

* cmd       -- The object's name becomes a command
* cmd_NAME  -- NAME becomes a command
* go        -- If you are going into the object, this replaces the go comand
* go_NAME   -- If you are going NAME, this replaces the go comand
* get       -- If you are getting the object, this replaces the get command
* get_NAME  -- If you are getting NAME, this replaces the get command

Command templates can use $N to substitute in the command's arguments (and 'me' for the actor).

* $0 is the object itself
* $1...$N are the words in the command (so go north will have $0 as the exit and $1 as 'north' which may be useful in a go_north property)

Use the help command for more details

# MUD Commands
Here are all of the current commands and the current help documentation:

```
@add thing property thing2                                      --  Add thing2 to the list or set in property
  If there is no property, create a set
  thing2 is optional
@admin thing boolean                                            --  Change a thing's admin privileges
@as thing command...                                            --  Make a thing execute a command
@clock seconds                                                  --  Change the clock rate
@copy thing
@copy thing force                                               --  Copy a thing to your inventory (force allows copying the entire world -- can be dangerous)
@create proto name [description words...]                       --  Create a thing
@del thing property                                             --  Delete a properties from a thing so it will inherit from its prototype
@dump thing                                                     --  See properties of a thing
@expr thing property expr                                       --  Set a property to the value of an expression
@find thing                                                     --  Find a thing
@find thing location                                            --  Find a thing from a location
@if condition CLAUSES @end                                      --  conditionally run commands
@if condition @then commands... @elseif condition @then commands ... @else commands... @end

@else and @end are optional, use @end if you nest @ifs
clauses can contain multiple commands separated by semicolons
Conditions can contain expressions -- see expressions

Example:
  @if me.x == 1 @then say one; @if true @then say derp @end @elseif me.x == 2 @then say two @else say other

@info                                                           --  List important information
@link loc1 link1 link2 loc2                                     --  create links between two things
@loud                                                           --  enable all output for this command
@move thing location                                            --  Move a thing
@mute                                                           --  temporarily silence all output commands that are not yours
@output contextThing "FORMAT" arg... @event actor EVENT arg...  --  Output text to the user and/or others using a format string on contextThing
  if the format is for others, @output will issue a descripton using information after @event
  actor can change output depending on who receives it
@quiet                                                          --  disable all output for this command
@remove thing property thing2                                   --  Remove thing2 from the list in property
@reproto thing proto                                            --  Change the prototype of a thing
@say "words..." arg...                                          --  Formatted say
@setNum thing property number
@setBigint thing property bigint
@setBool thing property boolean
@set thing property value                                       --  Set one of these properties on a thing:
  prototype   -- see the @info command
  article     -- the article for a thing's name
  name        -- the thing's fullName (the name will be set to the first word)
  count       -- how many there are of the thing (defaults to 1)
  location    -- move the thing to another location
  linkowner   -- set the thing's linkOwner
  otherlink   -- set the thing's otherLink
  description -- the thing's description, you can use format words in a description (see FORMAT WORDS).
                 If you capitalize a format word, the substitution will be capitalized.

  Here are the fields you can set:
    name            -- simple one-word name for this object, for commands to find it
    fullName        -- the formatted name
    article         -- precedes the formatted name when this is displayed
    description     -- shown for look/examine commands
    examineFormat   -- describes an item's contents and links
    contentsFormat  -- describes an item in contents
    linkFormat      -- decribes how this item links to its other link
    linkMoveFormat  -- shown to someone when they move through a link
    linkEnterFormat -- shown to occupants when someone enters through the link
    linkExitFormat  -- shown to occupants when someone leaves through the link
    location        -- if this thing has a location, it is in its location's contents
    linkOwner       -- the owner of this link (if this is a link)
    otherLink       -- the other link (if this is a link)
    keys[]          -- locks that this thing allows opening
    closed          -- whether this object propagates descriptons to its location
    template        -- whether to copy this object during a move command
    cmd             -- command template for when the object's name is used as a command
    cmd_WORD        -- command template for when the WORD is used as a command
    get             -- command template for when someone tries to get the object
    get_WORD        -- command template for when someone tries to get WORD
    go              -- command template for when someone tries to go into in object or through a link
    go_WORD         -- command template for when someone tries to go into WORD (virtual directions)
    react_EVENT     -- react to an event (or descripton), see EVENTS

@start                                                          --  Start the clock
@stop                                                           --  Stop the clock
@toast thing...                                                 --  Toast things and everything they're connected to
@unmute                                                         --  enable output from other commands
act words...                                                    --  Do something
drop thing                                                      --  drop something you are carrying
examine thing                                                   --  See a detailed description of a thing
gesture thing words...                                          --  Do something towards thing
get thing                                                       --  grab a thing
get thing [from] location                                       --  grab a thing from a location
go location                                                     --  move to another location (may be a direction)
help                                                            --  Show this message
i 
invent 
inventory                                                       --  list what you are carrying
login user password                                             --  Login to the mud
look                                                            --  See a description of your current location
look thing                                                      --  See a description of a thing
say words...                                                    --  Say something
whisper thing words...                                          --  Say something to thing

You can use me for yourself, here for your location, and out for your location's location (if you're in a container)
You can use %lobby, %limbo, and %protos for the standard rooms
You can use %proto:name for a prototype
You can use %NUMBER for an object by its ID (try @dump me for an example)
You can use %-NUMBER for an item you created recently (%-1 is the last item, %-2 is the next to last, etc.)
You can use %result to refer to the result of the active successful if-condition
You can use %result.PROPERTY to refer to a property of the result (including numeric indexes)
You can use %event to refer to the current event (descripton)
You can use %event.PROPERTY to refer to a property of the current event (descripton)

To make something into a prototype, move it to %protos

FORMAT WORDS:
  $this        -- formatted string for this object or "you" if the user is the thing
  $name        -- this object's name
  $is          -- is or are, depending on the plurality of the thing
  $s           -- optional "s" depending on the plurality of the thing (or "es" if it's after go)
  $location    -- the thing's location
  $owner       -- the link's owner (if this is a link)
  $link        -- the link's destination (if this is a link)
  $contents    -- the things's contents
  $links       -- the things's links
  $forme       -- following content is for messages shown to a command's actor
  $forothers   -- following content is for messages shown to observers of a command's actor
  $arg         -- first argument (if there is one)
  $argN        -- Nth argument (if there is one)
  $result      -- The result of the active successful if-condition
  $result.PROP -- A property of the current result (including numeric indexes)
  $event       -- The current event (descripton)
  $event.PROP  -- A property of the current event (descripton)


COMMAND TEMPLATES:

Command templates are string properties on objects to implement custom commands.
Example command template properties are get_key, cmd, and cmd_whistle -- see the help for @set.
Templates replace the original command with different commands, separated by semicolons.
Templates can contain $0..$N to refer to the command arguments. $0 refers to the thing itself.


EXPRESSIONS:

The following are legal expressions:
   number
   string
   boolean
   null
   undefined
   THING
   THING.property
   %any.property   -- returns the first value found on you or thing in your inventory
                      If property is a collection, it returns the union of all found
   '(' expr ')'
   expr1 + expr2
   expr1 - expr2
   expr1 * expr2
   expr1 / expr2
   expr1 < expr2
   expr1 <= expr2
   expr1 > expr2
   expr1 >= expr2
   Expr1 == expr2
   expr1 != expr2
   !expr1
   expr1 && expr2
   expr1 || expr2
   expr1 in expr2  -- returns whether expr1 is in expr2 (which must be a collection or a thing)


EVENTS:

When a thing executes a command, it emits an event which propagates to nearby things. Objects can react
to a type of event by setting a property called react_EVENT to a command template (see COMMAND TEMPLATES).
Events have properties which you can access in command templates with %event.PROPERTY and in format
strings with $event.PROPERTY.

Example, this will make a box react to people arriving in its location:

@set box react_go @if %event.1 == $0.location @then say Hello %event.source!


EVENT PROPERTIES:

   failed  -- whether the event is from a failed command
   source  -- the thing that emitted the event
   tick    -- the current tick number
   N       -- %event.0 ... %event.N and $event.0 ... $event.N refer to parameters in the event


EVENT TYPES:

These are the standard event types, listed with their standard parameters:

   get 0:thing
   drop 0:thing
   go 0:oldLocation 1:newLocation
   look 0:thing
   examine 0:thing
   tick
   say 0:text
   act 0:text 1:thing(opt)
```

# Extensions

Each MUD can have extensions. There is an example extension [here](html/js/exampleExtension.ts)

Extensions can optionally provide onStarted and onLoggedIn functions:

```TypeScript
function onStarted(world: World, con: MudConnection)

function onLoggedIn(user: any, thing: Thing)
```

They can import Textcraft modules by using the prefix `/js/` for module files (see example).

# Four levels of building

1. Creating things and setting properties
1. Using command templates
1. Writing extensions (like for game mechanics)
1. Changing the Textcraft executable

# MUD Model

## The Thing class

The World is made of things, and only things. Each room is a thing. Exits between rooms are things. People are things. Items are things. Boxes are things.

Bill's good friend, Fritz Passow, came up with this idea, which he called "Container MUD", where everything is a container.

The Thing class has these properties:

* id: an identifying number for this thing, unique among things
* name: the name; since this is used in commands, spaces are not allowed
* description: the description
* location: the thing this is located in -- if this is a link, it has no location
* contents: things inside this thing
* links: links (which are things) attached to this thing
* linkOwner: the thing that owns this link, if this is a link
* otherLink: the companion to this link, if this is a link

# More later...

For the moment, there are basic instructions for developing the MUD, below.

# Installing typescript

```shell
npm install -g typescript
```

# Using typescript

Run this in one terminal to compile as you edit -- note that we are using `--target esnext`

```shell
tsc -w
```

# USE TSLINT!!!
in another terminal, run this every now and then and *certainly* before pushing to a shared branch
```shell
tslint -p tsconfig.json
```

Run this in another terminal to serve up the web page -- we use modules so file:/// won't work :(. This will run the server on port 8888. You can change it with the -port option.

```shell
textcraft
```

# Things to look out for with async functions with database operations

When you call an async function, make sure to use await or return or the transaction will be lost!
