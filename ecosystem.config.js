// PM2 process config for the Droplet — `pm2 startOrReload ecosystem.config.js`
// Env vars are read from .env (dotenv) in the app directory, not from here.
module.exports = {
  apps: [
    {
      name: 'tindapo-backend',
      script: 'dist/server.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      env: { NODE_ENV: 'production' },
      // 512 MB droplet — restart before the box starts swapping hard
      max_memory_restart: '350M',
      node_args: '--max-old-space-size=320',
      time: true,
      out_file: 'logs/out.log',
      error_file: 'logs/error.log',
      merge_logs: true,
    },
  ],
};
