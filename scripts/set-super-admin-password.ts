// Change a super admin's password — run it yourself so the password never leaves your PC:
//   cd TindaPos-Backend
//   npx ts-node --transpile-only scripts/set-super-admin-password.ts
// Uses SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from .env. Typing is hidden.
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import readline from 'readline';
import { createClient } from '@supabase/supabase-js';

const MIN_LENGTH = 12;

function ask(question: string, hidden = false): Promise<string> {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      // Hide what is typed (show nothing after the question)
      const output = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
      output._writeToOutput = (s: string) => {
        if (s.includes(question)) output.output.write(s);
      };
    }
    rl.question(question, answer => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(answer.trim());
    });
  });
}

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('❌ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing in .env');
    process.exit(1);
  }
  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  const email = (await ask('Super admin email: ')).toLowerCase();
  const { data: admin } = await db.from('super_admins').select('id, email').eq('email', email).maybeSingle();
  if (!admin) {
    console.error(`❌ No super admin with email ${email}`);
    process.exit(1);
  }

  const password = await ask(`New password (min ${MIN_LENGTH} characters, hidden): `, true);
  if (password.length < MIN_LENGTH) {
    console.error(`❌ Too short — use at least ${MIN_LENGTH} characters`);
    process.exit(1);
  }
  const confirm = await ask('Type it again (hidden): ', true);
  if (confirm !== password) {
    console.error('❌ Passwords do not match');
    process.exit(1);
  }

  const hash = await bcrypt.hash(password, 12);
  const { error } = await db.from('super_admins').update({ password: hash, updated_at: new Date().toISOString() }).eq('id', admin.id);
  if (error) {
    console.error('❌ Update failed:', error.message);
    process.exit(1);
  }
  console.log(`✅ Password changed for ${admin.email}. Log in again at /system-admin with the new password.`);
}

main();
