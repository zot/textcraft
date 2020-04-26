![Textcraft MUD](images/textcraft.png "Textcraft MUD")

<b>Version <span id='versionID'></span></b>
<script>
function init(count) {
    if (window.textcraft) {
        window.textcraft.Gui.displayVersion();
        document.getElementById('muds').innerHTML = window.textcraft.Gui.exampleMuds;
    } else if (!count || count < 20) {
        setTimeout(()=> init((count || 0) + 1), 250);
    }
}
init();
</script>

# TEXTCRAFT

Textcraft is an oldskool text-based MUD with a twist -- it's peer-to-peer.

There are no servers. YOU own your data.

It relies on [libp2p](https://github.com/libp2p/go-libp2p) for peer-to-peer networking and uses [libp2p-websocket](https://github.com/zot/libp2p-websocket) to connect browsers to libp2p.

# MIT LICENSE

The MIT license is [here](LICENSE)

## Example MUDs

Shift-click or right-click and choose "Save link as..." to save these to your disk

<style>
.link {
    color: blue;
    text-decoration: underline;
    cursor: pointer;
}
</style>

<div id='muds'></div>

Here are all of the [example MUDs](http://localhost:8888/examples/)

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
@add thing property thing2                     --  Add thing2 to the list or set in property
  If there is no property, create a set
  thing2 is optional
@admin thing boolean                           --  Change a thing's admin privileges
@as thing command...                           --  Make a thing execute a command
@bluepill 
@bluepill thing                                --  Turn off verbose names for thing (or yourself if there is no argument
@call thing.property arg...                    --  Call a method on a thing
@clock seconds                                 --  Change the clock rate
@copy thing
@copy thing force                              --  Copy a thing to your inventory (force allows copying the entire world -- can be dangerous)
@create proto name [description words...]      --  Create a thing
@del thing property                            --  Delete a properties from a thing so it will inherit from its prototype
@delay command...                              --  Delay a command until after the current ones finish
@dump thing                                    --  See properties of a thing

   You can use % as a synonym for @dump if it's the first character of a command

@find thing                                    --  Find a thing
@find thing location                           --  Find a thing from a location
@info                                          --  List important information
@instances proto                               --  Display all instances
@js var1 = thing1, var2 = thing2... ; code...  --  Run JavaScript code with optional variable bindings

   Note that commas between variable bindings are optional
   The initial variable values are things looked up by name and bound to specProxies for the things
   You can use ! as a synonym for @js if it's the first character of a command

   The following are predefined for convenience:
     me                        specProxy for your thing
     anyHas(things, property)
     anyHas(things, property, item)
                               returns whether any of things is associated with item (defaults to 'me')
     findNearby()
     findNearby(thing)         PROMISE for nearby items (thing defaults to your thing)
     cmd(item, ...)            creates a command context
     cmdf(FORMAT, arg, ...)    creates a command context
     doThings(thing..., func)  find things and call func

   CommandContexts also support methods cmd() and cmdf() to allow chaining
   return a command context to run a command

   FOUR TYPES OF PROXIES

   SPEC PROXY
   Arguments to @js and @call are bound to specProxies, not to things. Spec proxies make it convienient
   to access its persisted properties, so value.name accesses thing._name in the value's thing. You can
   use vlaue._thing to get the real thing. Both spec proxies and their things support the other three
   types of proxies, below.

   ASSOC/ASSOCMANY PROXY !!! USES PROMISES !!!
   thing.assoc lets you access associations with other things by using promises. This means you need
   to AWAIT values. For example, to get a thing's location, you can say await thing.assoc.location.
   @dump will list all of a thing's associations and also everything associated with it. You can use
   thing.assocMany to get array results even if there is only one association a property.

   ASSOCID/ASSOCIDMANY PROXY
   thing.assocId lets you access associations by THING ID and does not use promises, so you don't need
   to use await. This means thing.assocId.location returns a NUMBER, NOT A THING. This means you need
   to AWAIT values, like with assoc proxies. You can use thing.assocIdMany to get array results even if
   there is only one association a property.

   REFS PROXY !!! USES PROMISES !!!
   thing.refs lets you access things associated with a thing by using promises. For example,
   thing.refs.location will return an array of everything located in thing.

@link loc1 link1 link2 loc2                    --  create links between two things
@loud                                          --  enable all output for this command
@method thing name (args...) body              --  Define a method on a thing
   The method actually runs in the context of the thing's MudConnection, not the thing itself
   @call calls the method with specProxies for whatever arguments it provides. See @js for details.

@move thing location                           --  Move a thing
@mute                                          --  temporarily silence all output commands that are not yours
@output contextThing FORMAT-AND-EVENT-ARGS...  --   Output text to the user and/or others using a format string on contextThing

  @output contextThing "FORMAT" arg... @event actor EVENT arg...
  @output contextThing "FORMAT" arg... @event actor false EVENT arg...

  if the format is for others, @output will emit a descripton using information after @event
  actor specifies who emits the descripton.
  Adding false before EVENT indicates that the event failed.
@quiet                                         --  disable all output for this command
@redpill 
@redpill thing                                 --  Turn on verbose names for thing (or yourself if there is no argument
@remove thing property thing2                  --  Remove thing2 from the list in property
@reproto thing proto                           --  Change the prototype of a thing
@say "words..." arg...                         --  Formatted say
@setNum thing property number
@setBigint thing property bigint
@setBool thing property boolean
@set thing property value                      --  Set one of these properties on a thing:
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

@start                                         --  Start the clock
@stop                                          --  Stop the clock
@toast thing...                                --  Toast things and everything they're connected to
@unmute                                        --  enable output from other commands
act words...                                   --  Do something

   You can use : as a synonym for act if it's the first character of a command

drop thing                                     --  drop something you are carrying
examine thing                                  --  See a detailed description of a thing
gesture thing words...                         --  Do something towards thing
get thing                                      --  grab a thing
get thing [from] location                      --  grab a thing from a location
go location                                    --  move to another location (may be a direction)
help                                           --  Show this message
i 
invent 
inventory                                      --  list what you are carrying
login user password                            --  Login to the mud
look                                           --  See a description of your current location
look thing                                     --  See a description of a thing
say words...                                   --  Say something

   You can use ' or " as a synonym for say if it's the first character of a command

whisper thing words...                         --  Say something to thing

You can use me for yourself, here for your location, and out for your location's location (if you're in a container)
You can use %lobby, %limbo, and %protos for the standard rooms
You can use %proto:name for a prototype
You can use %NUMBER for an object by its ID (try @dump me for an example)
You can use %-NUMBER for an item you created recently (%-1 is the last item, %-2 is the next to last, etc.)
You can use %result to refer to the result of the active successful if-condition
You can use %result.PROPERTY to refer to a property of the result (including numeric indexes)
You can use %event to refer to the current event (descripton)
You can use %event.PROPERTY to refer to a property of the current event (descripton)
You can use %NAME as a synonym of NAME for convenience, this helps when using %thing as a command

To make something into a prototype, move it to %protos

FORMAT WORDS:
  $quote       -- turn off formatting for the rest of the text
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
  $admin ....  -- If the user is an admin, use everything after $admin instead


COMMAND TEMPLATES:

Command templates are string properties on objects to implement custom commands.
Example command template properties are get_key, cmd, and cmd_whistle -- see the help for @set.
Templates replace the original command with different commands, separated by semicolons.
Templates can contain $0..$N to refer to the command arguments. $0 refers to the thing itself.


EVENTS:

When a thing executes a command, it emits an event which propagates to nearby things. Objects can react
to a type of event by creating a command template called react_EVENT or a method called react_EVENT.
In either case, the reaction takes an argument for the emmiter and each of the event's parameters.
Events have properties which you can access in command templates with %event.PROPERTY and in format
strings with $event.PROPERTY. In methods, this.event refers to the current event.

Example, this will make a box react to people arriving in its location:

@method box react_go (thing, oldLoc, newLoc) this.thing.isIn(newLoc) && cmd('say Hello %event.source!')


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
