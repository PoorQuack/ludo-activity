# Before this branch goes live

This branch (`test/gems-stakes-hub`) is the next update: Gold Coins and VIP Gems, stakes rooms with
the pot shared by place, the hub menu, Global and language chat with Translate, the all-time and
stakes leaderboard with a podium, the Battle Pass, the new frames, badges and currency icons.

## Discord SKUs (Developer Portal -> app 1566220630527840266 -> Monetization)

| Code id   | Product          | Type              | SKU id |
|-----------|------------------|-------------------|--------|
| pack-1    | Pouch of gems    | Consumable, £0.99 | `1575076360710393907` |
| pack-2    | Bag of gems      | Consumable, £1.99 | `1575076676478566571` |
| pack-3    | Chest of gems    | Consumable, £4.99 | `1575076827041628231` |
| pack-4    | Vault of gems    | Consumable, £9.99 | `1575076944620429322` |
| coffee-1  | Small coffee     | Consumable, £2.99 | `1575077678850121818` |
| pass      | Battle Pass      | User subscription (`type: 5`) | `1575077912472977531` |

*(Note: `1575077912472977528` in Discord is the `type: 6` "User Subscription Group" container for Battle Pass, not the purchasable SKU.)*

Add this line to the VM's `~/ludo-activity/.env` when deploying this branch (`DISCORD_BOT_TOKEN` is already set there):

```
SHOP_SKUS=pack-1:1575076360710393907,pack-2:1575076676478566571,pack-3:1575076827041628231,pack-4:1575076944620429322,coffee-1:1575077678850121818,pass:1575077912472977531
```

Only add it in the same deploy as this branch: the live `main` still sells coin packs under the
same ids.

## Deploying

1. Merge this branch into `main`, then on the VM: `git pull`, `npm ci`, `npm run build`, `pm2 restart ludo`.
2. The profile file upgrades itself (v3: everyone gets `gems: 0`), and the leaderboard file starts
   new boards (stakes scoring; past winners are kept).
3. Check in Discord with a test purchase (free for the app owner): a gem pack, then the Battle Pass.
