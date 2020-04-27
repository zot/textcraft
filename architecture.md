# Things

Things can:

1. Have properties (which can be methods)
2. Have associations with other things (one-to-one, many-to-one, many-to-many)
3. Contain other things
4. Link to other things
5. Function as links between things
6. Provide new commands
7. Control what happens when things move into or through them
8. React to events

In game code, you get and set a thing's associations through thing.assoc.NAME and thing.assocMany.NAME.
Assoc is for one-to-one and many-to-one associations and assocMany is for many-to-many associations.

So to get a thing's location, you say thing.assoc.location. To set it, say
thing.assoc.location = newLocation. This replaces the old location with the new one.
thing.assoc.location will normally return either null or a thing.

If you want to accumulate more than one value in an association, you can use thing.assocMany, like
thing.assocMany.friend = bob. Each assignment will add an item to the set (but each item will occur
only once). thing.assocMany.bob will always return an array, even if you've never used that property.

To remove an item from a thing's associations, you say thing.assoc.dissociate(name, item) or
thing.assoc.dissociateFrom(item), to remove all associations to it. To remove all items from a
particular association, you can say thing.dissociateNamed(name) or you can assign to refs (see
below).

If you do happen to use assoc to access a many-valued association, it will return an array.

You use thing.refs.NAME to get the things that refer back to this thing through their NAME association.
So to get the contents of a room, you say room.assoc.location. You can remove all refs of a particular
type to a thing by assigning thing.refs.NAME = []. Assigning it any other value is currently an error
because there is no way to know whether to delete old values for those refs (associations don't currently
track cardinality).

# Standard rooms

## The Hall of Prototypes
This is normally where protytpes live. The @create command searches the Hall of Prototypes for the
prototype you provide.

## Limbo
Things that have no other location go to Limbo

## The Lobby
New connections start in the Lobby

# Standard prototypes

## Thing

## Person

## Room

## Link

## Generator

