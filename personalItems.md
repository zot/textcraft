# Making personal items

## Create a group prototype off of %proto:pgenerator and set its group
```
@create pgenerator tombsthing
@move %-1 %protos
@set %-1 group tombs
```

Moving tombsthing to %protos makes it a prototype so the @create command can access it easily

## Create a generator for each thing in the group
```
@create tombsthing a pile of rusty keys
@set %-1 name key
```

When someone tries to get one, it creates a new thing and associates it with the person who
got it using the group name and item name as association links.

So get key will make a key with associations tombs -> creator, and key -> creator.

For ownership checks, use: item.assoc.key == me

To get all the tombs things you created: me.refs.tombs

To get the key: me.refs.key
