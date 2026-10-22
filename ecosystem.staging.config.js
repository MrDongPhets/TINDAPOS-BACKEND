// PM2 config for the STAGING backend on the same Droplet — `pm2 startOrReload ecosystem.staging.config.js`
// https://staging-api.tindapo.com → Nginx → 127.0.0.1:3002. Deployed from branch feat/invoicing (deploy-staging.yml).
// Env vars come from /home/deploy/tindapo-staging/.env; PORT here wins (dotenv never overrides set variables).
module.exports = {
  apps: [
    {
      name: 'tindapo-staging',
      script: 'dist/server.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      env: { NODE_ENV: 'production', PORT: '3002' },
      // Shares the 512 MB droplet with live: keep staging small so live keeps priority
      max_memory_restart: '200M',
      node_args: '--max-old-space-size=180',
      time: true,
      out_file: 'logs/out.log',
      error_file: 'logs/error.log',
      merge_logs: true,
    },
  ],
};
