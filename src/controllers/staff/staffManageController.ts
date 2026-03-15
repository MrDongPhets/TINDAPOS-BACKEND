import { Request, Response } from 'express';
import { getDb } from '../../config/database';
import bcrypt from 'bcrypt';

// Create new staff
async function createStaff(req: Request, res: Response): Promise<void> {
  try {
    const { staff_id, name, passcode, role = 'staff', store_id } = req.body;
    const { company_id } = req.user!;

    // Validation
    if (!staff_id || !name || !passcode || !store_id) {
      res.status(400).json({
        error: 'Staff ID, name, passcode, and store are required'
      });
      return;
    }

    if (passcode.length < 4 || passcode.length > 6) {
      res.status(400).json({
        error: 'Passcode must be 4-6 digits'
      });
      return;
    }

    // Hash the passcode
    const hashedPasscode = await bcrypt.hash(passcode, 10);

    const supabase = getDb();

    // Check if staff_id already exists
    const { data: existing } = await supabase
      .from('staff')
      .select('staff_id')
      .eq('staff_id', staff_id)
      .single();

    if (existing) {
      res.status(400).json({
        error: 'Staff ID already exists'
      });
      return;
    }

    // Create staff
    const { data, error } = await supabase
      .from('staff')
      .insert([{
        staff_id,
        name,
        passcode: hashedPasscode,
        role,
        store_id,
        company_id,
        is_active: true,
        created_by: req.user!.id
      }])
      .select()
      .single();

    if (error) throw error;

    res.json({
      success: true,
      staff: {
        id: data.id,
        staff_id: data.staff_id,
        name: data.name,
        role: data.role,
        store_id: data.store_id
      }
    });

  } catch (error) {
    console.error('Create staff error:', error);
    res.status(500).json({ error: 'Failed to create staff' });
  }
}

// Get all staff for company (all stores)
async function listStaff(req: Request, res: Response): Promise<void> {
  try {
    const { company_id } = req.user!;
    const supabase = getDb();

    const { data, error } = await supabase
      .from('staff')
      .select('id, staff_id, name, role, store_id, is_active, created_at')
      .eq('company_id', company_id)
      .order('created_at', { ascending: false });

    if (error) throw error;

    res.json({ staff: data || [] });

  } catch (error) {
    console.error('List staff error:', error);
    res.status(500).json({ error: 'Failed to fetch staff' });
  }
}

// Update staff
async function updateStaff(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { name, role, is_active, passcode } = req.body;
    const { company_id } = req.user!;

    const supabase = getDb();

    const updateData: Record<string, unknown> = {
      updated_at: new Date().toISOString()
    };

    if (name) updateData.name = name;
    if (role) updateData.role = role;
    if (is_active !== undefined) updateData.is_active = is_active;

    // If changing passcode, hash it
    if (passcode) {
      updateData.passcode = await bcrypt.hash(passcode, 10);
    }

    const { data, error } = await supabase
      .from('staff')
      .update(updateData)
      .eq('id', id)
      .eq('company_id', company_id)
      .select()
      .single();

    if (error) throw error;

    res.json({ success: true, staff: data });

  } catch (error) {
    console.error('Update staff error:', error);
    res.status(500).json({ error: 'Failed to update staff' });
  }
}

// Delete staff
async function deleteStaff(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { company_id } = req.user!;

    const supabase = getDb();

    const { error } = await supabase
      .from('staff')
      .delete()
      .eq('id', id)
      .eq('company_id', company_id);

    if (error) throw error;

    res.json({ success: true });

  } catch (error) {
    console.error('Delete staff error:', error);
    res.status(500).json({ error: 'Failed to delete staff' });
  }
}

export {
  createStaff,
  listStaff,
  updateStaff,
  deleteStaff
};
