// pm2 config: `pm2 start ecosystem.config.cjs`
module.exports = {
  apps: [
    {
      name: 'ludo',
      script: 'server/index.js',
      max_memory_restart: '300M',
      env: { NODE_ENV: 'production' },
    },
  ],
};
