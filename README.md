# Loot Goblin

A small, retro-MMO-styled web app for broke PC gamers. Browse free game giveaways, cheap deals and free-to-play games, fight monsters for loot, and "loot" items into a bank that totals how much money you've saved.

## Features

- **Giveaways**: live free games and DLC from [GamerPower](https://www.gamerpower.com/api-read), filterable by platform
- **Deals**: discounted PC games from [CheapShark](https://apidocs.cheapshark.com/), sortable by discount, price or Metacritic score
- **Free-to-Play**: the [FreeToGame](https://www.freetogame.com/api-doc) catalogue, filterable by genre
- **Fight**: battle a random monster from the [D&D 5e API](https://www.dnd5eapi.co/) using melee, ranged or magic (melee beats ranged, ranged beats magic, magic beats melee). Win to get a random giveaway or deal as a loot drop.
- **Bank**: everything you've looted, with a running total saved, stored in your browser's `localStorage`

## Running locally

It's plain HTML, CSS and JavaScript with no build step. Serve the folder with any static server, for example:

```
python -m http.server 8000
```

Then open http://localhost:8000.

## Notes

The look is inspired by classic MMO interfaces and is built entirely from CSS and a free Google Font. It uses no game assets.
