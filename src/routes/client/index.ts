import express, { Request, Response } from 'express';
import { authenticateToken, requireClient, requireActiveSubscription } from '../../middleware/auth';
import { getDb } from '../../config/database';
import bcrypt from 'bcryptjs';

import dashboardRoutes from './dashboard';
import productsRoutes from './products';
import categoriesRoutes from './categories';
import inventoryRoutes from './inventory';
import salesRoutes from './sales';
import uploadRoutes from './upload';
import storesRoutes from './stores';
import inventoryTransferRoutes from './inventorytransfer';
import ingredientsRoutes from './ingredients';
import recipesRoutes from './recipes';
import manufacturingRoutes from './manufacturing';
import utangRoutes from './utang';

const router = express.Router();

// Apply authentication to all client routes
router.use(authenticateToken);
router.use(requireClient);
router.use(requireActiveSubscription);

// GET /client/company — returns company info including company_code
router.get('/company', async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { data: companies, error } = await db
      .from('companies')
      .select('id, name, company_code, contact_email, contact_phone, address, website, logo_url, subscription_status, trial_end_date, subscription_end_date')
      .eq('id', req.user!.company_id)
      .limit(1);

    if (error || !companies || companies.length === 0) {
      res.status(404).json({ error: 'Company not found' });
      return;
    }
    const company = companies[0];
    const endDate = company.subscription_status === 'active'
      ? company.subscription_end_date
      : company.trial_end_date;
    const daysLeft = endDate
      ? Math.ceil((new Date(endDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
      : null;
    res.json({ company: { ...company, days_left: daysLeft } });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /client/settings — get user profile + receipt settings
router.get('/settings', async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { data: user, error: userErr } = await db
      .from('users')
      .select('id, name, email')
      .eq('id', req.user!.id)
      .single();
    if (userErr) throw userErr;

    const { data: company, error: companyErr } = await db
      .from('companies')
      .select('settings')
      .eq('id', req.user!.company_id)
      .single();
    if (companyErr) throw companyErr;

    res.json({ user, receipt: company?.settings?.receipt || {} });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /client/settings/account — update name/email/password
router.put('/settings/account', async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { name, email, current_password, new_password } = req.body;
    const updateData: any = {};

    if (name) updateData.name = name;
    if (email) updateData.email = email;

    if (new_password) {
      if (!current_password) {
        res.status(400).json({ error: 'Current password is required' });
        return;
      }
      const { data: user } = await db.from('users').select('password').eq('id', req.user!.id).single();
      const valid = await bcrypt.compare(current_password, user.password);
      if (!valid) {
        res.status(400).json({ error: 'Current password is incorrect' });
        return;
      }
      updateData.password = await bcrypt.hash(new_password, 10);
    }

    const { error } = await db.from('users').update(updateData).eq('id', req.user!.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /client/settings/receipt — update receipt settings
router.put('/settings/receipt', async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { header, footer, show_address, show_cashier } = req.body;

    const { data: company } = await db.from('companies').select('settings').eq('id', req.user!.company_id).single();
    const currentSettings = company?.settings || {};
    const updatedSettings = { ...currentSettings, receipt: { header, footer, show_address, show_cashier } };

    const { error } = await db.from('companies').update({ settings: updatedSettings }).eq('id', req.user!.company_id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Mount client routes
router.use('/dashboard', dashboardRoutes);
router.use('/products', productsRoutes);
router.use('/categories', categoriesRoutes);
router.use('/inventory', inventoryRoutes);
router.use('/sales', salesRoutes);
router.use('/upload', uploadRoutes);
router.use('/stores', storesRoutes);
router.use('/inventory-transfer', inventoryTransferRoutes);
router.use('/ingredients', ingredientsRoutes);
router.use('/recipes', recipesRoutes);
router.use('/manufacturing', manufacturingRoutes);
router.use('/utang', utangRoutes);

export default router;
