// src/controllers/staff/staffAuthController.ts - Updated with activity logging
import { Request, Response } from 'express';
import { getDb } from '../../config/database';
import bcrypt from 'bcrypt';
import { generateToken } from '../../services/tokenService';

// Staff PIN Login
async function staffLogin(req: Request, res: Response): Promise<void> {
  try {
    const { staff_id, passcode, store_id } = req.body;

    if (!staff_id || !passcode || !store_id) {
      res.status(400).json({
        error: 'Staff ID, passcode, and store ID are required'
      });
      return;
    }

    const supabase = getDb();

    // Get staff by staff_id and store_id
    const { data: staff, error } = await supabase
      .from('staff')
      .select('*')
      .eq('staff_id', staff_id)
      .eq('store_id', store_id)
      .eq('is_active', true)
      .single();

    if (error || !staff) {
      // Log failed login attempt (if we have the staff record)
      if (staff) {
        await supabase
          .from('staff_activity_logs')
          .insert([{
            staff_id: staff.id,
            company_id: staff.company_id,
            store_id: staff.store_id,
            action_type: 'failed_login',
            action_details: {
              staff_id_attempted: staff_id,
              reason: 'Staff not found or inactive',
              ip_address: req.ip || (req.connection as { remoteAddress?: string }).remoteAddress
            },
            ip_address: req.ip || (req.connection as { remoteAddress?: string }).remoteAddress,
            user_agent: req.headers['user-agent']
          }]);
      }

      res.status(401).json({
        error: 'Invalid credentials'
      });
      return;
    }

    // Verify passcode
    const isValidPasscode = await bcrypt.compare(passcode, staff.passcode);
    if (!isValidPasscode) {
      // Log failed login attempt
      await supabase
        .from('staff_activity_logs')
        .insert([{
          staff_id: staff.id,
          company_id: staff.company_id,
          store_id: staff.store_id,
          action_type: 'failed_login',
          action_details: {
            staff_id_attempted: staff_id,
            reason: 'Invalid passcode',
            ip_address: req.ip || (req.connection as { remoteAddress?: string }).remoteAddress
          },
          ip_address: req.ip || (req.connection as { remoteAddress?: string }).remoteAddress,
          user_agent: req.headers['user-agent']
        }]);

      res.status(401).json({
        error: 'Invalid credentials'
      });
      return;
    }

    // Generate token for staff
    const token = generateToken({
      id: staff.id,
      email: `staff_${staff.staff_id}@internal.pos`,
      role: staff.role,
      company_id: staff.company_id,
      store_id: staff.store_id
    }, 'staff');

    // Log successful login
    await supabase
      .from('staff_activity_logs')
      .insert([{
        staff_id: staff.id,
        company_id: staff.company_id,
        store_id: staff.store_id,
        action_type: 'login',
        action_details: {
          staff_id: staff.staff_id,
          login_time: new Date().toISOString()
        },
        ip_address: req.ip || (req.connection as { remoteAddress?: string }).remoteAddress,
        user_agent: req.headers['user-agent']
      }]);

    // Update last login
    await supabase
      .from('staff')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', staff.id);

    res.json({
      token,
      userType: 'staff',
      staff: {
        id: staff.id,
        staff_id: staff.staff_id,
        name: staff.name,
        role: staff.role,
        store_id: staff.store_id,
        company_id: staff.company_id,
        image_url: staff.image_url
      }
    });

  } catch (error) {
    console.error('Staff login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// Staff Logout
async function staffLogout(req: Request, res: Response): Promise<void> {
  try {
    const { id: staff_id, company_id, store_id } = req.user!;
    const supabase = getDb();

    // Log logout
    await supabase
      .from('staff_activity_logs')
      .insert([{
        staff_id,
        company_id,
        store_id,
        action_type: 'logout',
        action_details: {
          logout_time: new Date().toISOString()
        },
        ip_address: req.ip || (req.connection as { remoteAddress?: string }).remoteAddress,
        user_agent: req.headers['user-agent']
      }]);

    res.json({
      success: true,
      message: 'Logged out successfully'
    });

  } catch (error) {
    console.error('Staff logout error:', error);
    res.status(500).json({ error: 'Failed to logout' });
  }
}

// Verify Staff Token
async function verifyStaffToken(req: Request, res: Response): Promise<void> {
  try {
    // Token is already verified by middleware
    const staffId = req.user!.id;
    const supabase = getDb();

    const { data: staff, error } = await supabase
      .from('staff')
      .select('*')
      .eq('id', staffId)
      .eq('is_active', true)
      .single();

    if (error || !staff) {
      res.status(401).json({
        valid: false,
        error: 'Staff not found or inactive'
      });
      return;
    }

    res.json({
      valid: true,
      staff: {
        id: staff.id,
        staff_id: staff.staff_id,
        name: staff.name,
        role: staff.role,
        store_id: staff.store_id,
        company_id: staff.company_id
      }
    });

  } catch (error) {
    console.error('Verify staff token error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export {
  staffLogin,
  staffLogout,
  verifyStaffToken
};
