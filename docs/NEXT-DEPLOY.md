# Before this branch goes live

This branch (`test/gems-stakes-hub`) is the next update: Gold Coins and VIP Gems, stakes rooms with
the pot shared by place, the hub menu, Global and language chat with Translate, the all-time and
stakes leaderboard with a podium, the Battle Pass, the new frames, badges and currency icons.

## Discord SKUs (Developer Portal -> app 1566220630527840266 -> Monetization)

| Code id   | Product          | Type              | SKU id |
|-----------|------------------|-------------------|--------|
| pack-1    | Pouch of gems    | Consumable, $0.99 | ? |
| pack-2    | Bag of gems      | Consumable, $1.99 | ? |
| pack-3    | Chest of gems    | Consumable, $4.99 | ? |
| pack-4    | Vault of gems    | Consumable, $9.99 | ? |
| coffee-1  | Small coffee     | Consumable, $2.99 | ? |
| pass      | Battle Pass      | User subscription, $4.99/month | ? |

SKU ids sent so far, not yet matched to a product (the id is the number after `/skus/` in the
SKU's page address):

- 1575077912472977531
- 1575076360710393907
- 1575076827041628231

Once every row has its id, add one line to the VM's `~/ludo-activity/.env` (DISCORD_BOT_TOKEN must
be set there too):

```
SHOP_SKUS=pack-1:<id>,pack-2:<id>,pack-3:<id>,pack-4:<id>,coffee-1:<id>,pass:<id>
```

Only add it in the same deploy as this branch: the live `main` still sells coin packs under the
same ids.

## Deploying

1. Merge this branch into `main`, then on the VM: `git pull`, `npm ci`, `npm run build`, `pm2 restart ludo`.
2. The profile file upgrades itself (v3: everyone gets `gems: 0`), and the leaderboard file starts
   new boards (stakes scoring; past winners are kept).
3. Check in Discord with a test purchase (free for the app owner): a gem pack, then the Battle Pass.
