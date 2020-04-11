![Textcraft MUD](html/images/textcraft.png "Textcraft MUD")

# TEXTCRAFT

Textcraft is an oldskool text-based MUD with a twist -- it's peer-to-peer.

There are no servers. YOU own your data.

It relies on [libp2p](https://github.com/libp2p/go-libp2p) for peer-to-peer networking and uses [libp2p-websocket](https://github.com/zot/libp2p-websocket) to connect browsers to libp2p.

# Using the MUD

1. Start by creating or uploading a MUD
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

# Extensions

Each MUD can have extensions. There is an example extension [here](html/js/exampleExtension.ts)

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

# MIT LICENSE

The MIT license is [here](LICENSE)

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
