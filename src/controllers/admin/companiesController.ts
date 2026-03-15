import { Request, Response } from 'express';
import { getDb } from '../../config/database';

async function getCompanies(req: Request, res: Response): Promise<void> {
  try {
    console.log('🏢 Fetching companies data...');

    const supabase = getDb();

    const { data: companies, error: companiesError } = await supabase
      .from('companies')
      .select('*')
      .order('created_at', { ascending: false });

    if (companiesError) {
      console.error('Failed to fetch companies:', companiesError.message);
      res.status(500).json({
        error: 'Failed to fetch companies',
        code: 'DB_ERROR',
        details: companiesError.message
      });
      return;
    }

    console.log(`✅ Found ${companies?.length || 0} companies`);

    res.json({
      companies: companies || [],
      count: companies?.length || 0,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    const err = error as Error;
    console.error('❌ Get companies error:', err.message);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR',
      details: err.message
    });
  }
}

export { getCompanies };
