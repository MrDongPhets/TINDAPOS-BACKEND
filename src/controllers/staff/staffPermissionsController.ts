// src/controllers/staff/staffPermissionsController.ts
import { Request, Response } from 'express';
import { getDb } from '../../config/database';
import bcrypt from 'bcrypt';

// Get role permissions matrix
async function getRolePermissions(req: Request, res: Response): Promise<void> {
  try {
    const permissions = {
      staff: {
        level: 1,
        label: 'Staff',
        description: 'Basic POS operations',
        permissions: {
          process_sale: true,
          open_cash_drawer: true,
          view_products: true,
          search_products: true,
          scan_barcode: true,
          print_receipt: true,
          void_transaction: false,
          apply_discount: false,
          process_refund: false,
          price_override: false,
          view_reports: false,
          manage_inventory: false,
          manage_staff: false,
          end_of_day: false
        }
      },
      supervisor: {
        level: 2,
        label: 'Supervisor',
        description: 'POS operations with limited management',
        permissions: {
          process_sale: true,
          open_cash_drawer: true,
          view_products: true,
          search_products: true,
          scan_barcode: true,
          print_receipt: true,
          void_transaction: true,
          apply_discount: true,
          process_refund: false,
          price_override: false,
          view_reports: true,
          manage_inventory: false,
          manage_staff: false,
          end_of_day: true
        }
      },
      manager: {
        level: 3,
        label: 'Manager',
        description: 'Full access to all operations',
        permissions: {
          process_sale: true,
          open_cash_drawer: true,
          view_products: true,
          search_products: true,
          scan_barcode: true,
          print_receipt: true,
          void_transaction: true,
          apply_discount: true,
          process_refund: true,
          price_override: true,
          view_reports: true,
          manage_inventory: true,
          manage_staff: true,
          end_of_day: true
        }
      }
    };

    res.json({ permissions });
  } catch (error) {
    console.error('Get role permissions error:', error);
    res.status(500).json({ error: 'Failed to get role permissions' });
  }
}

// Update staff role
async function updateStaffRole(req: Request, res: Response): Promise<void> {
  try {
    const { staff_id } = req.params;
    const { role } = req.body;
    const { company_id, id: manager_id, role: manager_role } = req.user!;

    // Only managers can update roles
    if (manager_role !== 'manager') {
      res.status(403).json({
        error: 'Only managers can update staff roles'
      });
      return;
    }

    // Validate role
    const validRoles = ['staff', 'supervisor', 'manager'];
    if (!validRoles.includes(role)) {
      res.status(400).json({
        error: 'Invalid role. Must be staff, supervisor, or manager'
      });
      return;
    }

    const supabase = getDb();

    // Get current staff info
    const { data: staff, error: fetchError } = await supabase
      .from('staff')
      .select('*, store_id')
      .eq('id', staff_id)
      .eq('company_id', company_id)
      .single();

    if (fetchError || !staff) {
      res.status(404).json({
        error: 'Staff not found'
      });
      return;
    }

    const oldRole = staff.role;

    // Update staff role
    const { error: updateError } = await supabase
      .from('staff')
      .update({
        role,
        updated_at: new Date().toISOString()
      })
      .eq('id', staff_id)
      .eq('company_id', company_id);

    if (updateError) throw updateError;

    // Log the role change
    await supabase
      .from('staff_activity_logs')
      .insert([{
        staff_id: staff_id,
        company_id: company_id,
        store_id: staff.store_id,
        action_type: 'role_changed',
        action_details: {
          old_role: oldRole,
          new_role: role,
          changed_by: manager_id
        }
      }]);

    res.json({
      success: true,
      message: `Staff role updated to ${role}`,
      staff: {
        id: staff_id,
        role: role
      }
    });

  } catch (error) {
    console.error('Update staff role error:', error);
    res.status(500).json({ error: 'Failed to update staff role' });
  }
}

// Manager override verification
async function verifyManagerOverride(req: Request, res: Response): Promise<void> {
  try {
    const { manager_staff_id, passcode, action, reason } = req.body;
    const { company_id, store_id, id: requesting_staff_id } = req.user!;

    if (!manager_staff_id || !passcode || !action) {
      res.status(400).json({
        error: 'Manager staff ID, passcode, and action are required'
      });
      return;
    }

    const supabase = getDb();

    // Get manager by staff_id
    const { data: manager, error } = await supabase
      .from('staff')
      .select('*')
      .eq('staff_id', manager_staff_id)
      .eq('company_id', company_id)
      .eq('store_id', store_id)
      .eq('is_active', true)
      .single();

    if (error || !manager) {
      res.status(401).json({
        error: 'Invalid manager credentials'
      });
      return;
    }

    // Verify manager has sufficient permissions
    const roleHierarchy: Record<string, number> = {
      manager: 3,
      supervisor: 2,
      staff: 1
    };

    const requiredLevel: Record<string, number> = {
      'void_transaction': 2, // supervisor or above
      'apply_discount': 2,   // supervisor or above
      'process_refund': 3,   // manager only
      'price_override': 3    // manager only
    };

    const managerLevel = roleHierarchy[manager.role] || 0;
    const requiredActionLevel = requiredLevel[action] || 3;

    if (managerLevel < requiredActionLevel) {
      res.status(403).json({
        error: `${manager.role} role cannot authorize ${action}`
      });
      return;
    }

    // Verify passcode
    const isValidPasscode = await bcrypt.compare(passcode, manager.passcode);
    if (!isValidPasscode) {
      // Log failed override attempt
      await supabase
        .from('staff_activity_logs')
        .insert([{
          staff_id: requesting_staff_id,
          company_id: company_id,
          store_id: store_id,
          action_type: 'failed_manager_override',
          action_details: {
            attempted_manager: manager_staff_id,
            action: action,
            reason: reason
          }
        }]);

      res.status(401).json({
        error: 'Invalid manager passcode'
      });
      return;
    }

    // Log successful manager override
    await supabase
      .from('staff_activity_logs')
      .insert([{
        staff_id: requesting_staff_id,
        company_id: company_id,
        store_id: store_id,
        action_type: 'manager_override',
        action_details: {
          authorized_by: manager.id,
          authorized_by_staff_id: manager.staff_id,
          authorized_by_name: manager.name,
          action: action,
          reason: reason
        }
      }]);

    res.json({
      success: true,
      authorized: true,
      manager: {
        id: manager.id,
        staff_id: manager.staff_id,
        name: manager.name,
        role: manager.role
      },
      action: action
    });

  } catch (error) {
    console.error('Manager override verification error:', error);
    res.status(500).json({ error: 'Failed to verify manager override' });
  }
}

// Log staff activity
async function logActivity(req: Request, res: Response): Promise<void> {
  try {
    const { action_type, action_details } = req.body;
    const { id: staff_id, company_id, store_id } = req.user!;

    if (!action_type) {
      res.status(400).json({
        error: 'Action type is required'
      });
      return;
    }

    const supabase = getDb();

    // Get IP and user agent from request
    const ip_address = req.ip || (req.connection as { remoteAddress?: string }).remoteAddress;
    const user_agent = req.headers['user-agent'];

    await supabase
      .from('staff_activity_logs')
      .insert([{
        staff_id,
        company_id,
        store_id,
        action_type,
        action_details: action_details || {},
        ip_address,
        user_agent
      }]);

    res.json({ success: true });

  } catch (error) {
    console.error('Log activity error:', error);
    res.status(500).json({ error: 'Failed to log activity' });
  }
}

// Get staff activity logs
async function getActivityLogs(req: Request, res: Response): Promise<void> {
  try {
    const { company_id, role, store_id } = req.user!;
    const { staff_id, action_type, limit = 50, offset = 0 } = req.query;

    // Only managers and supervisors can view activity logs
    if (!['manager', 'supervisor'].includes(role)) {
      res.status(403).json({
        error: 'Insufficient permissions to view activity logs'
      });
      return;
    }

    const supabase = getDb();

    let query = supabase
      .from('staff_activity_logs')
      .select(`
        *,
        staff:staff_id (
          staff_id,
          name,
          role
        )
      `, { count: 'exact' })
      .eq('company_id', company_id)
      .order('created_at', { ascending: false })
      .range(parseInt(String(offset)), parseInt(String(offset)) + parseInt(String(limit)) - 1);

    // Supervisors can only view logs from their store
    if (role === 'supervisor') {
      query = query.eq('store_id', store_id);
    }

    // Filter by staff_id if provided
    if (staff_id) {
      query = query.eq('staff_id', staff_id);
    }

    // Filter by action_type if provided
    if (action_type) {
      query = query.eq('action_type', action_type);
    }

    const { data, error, count } = await query;

    if (error) throw error;

    res.json({
      logs: data || [],
      total: count,
      limit: parseInt(String(limit)),
      offset: parseInt(String(offset))
    });

  } catch (error) {
    console.error('Get activity logs error:', error);
    res.status(500).json({ error: 'Failed to get activity logs' });
  }
}

// Change staff passcode
async function changePasscode(req: Request, res: Response): Promise<void> {
  try {
    const { current_passcode, new_passcode } = req.body;
    const { id: staff_id, company_id, store_id } = req.user!;

    if (!current_passcode || !new_passcode) {
      res.status(400).json({
        error: 'Current and new passcode are required'
      });
      return;
    }

    if (new_passcode.length < 4 || new_passcode.length > 6) {
      res.status(400).json({
        error: 'New passcode must be 4-6 digits'
      });
      return;
    }

    const supabase = getDb();

    // Get current staff
    const { data: staff, error: fetchError } = await supabase
      .from('staff')
      .select('*')
      .eq('id', staff_id)
      .single();

    if (fetchError || !staff) {
      res.status(404).json({
        error: 'Staff not found'
      });
      return;
    }

    // Verify current passcode
    const isValidPasscode = await bcrypt.compare(current_passcode, staff.passcode);
    if (!isValidPasscode) {
      res.status(401).json({
        error: 'Current passcode is incorrect'
      });
      return;
    }

    // Hash new passcode
    const hashedPasscode = await bcrypt.hash(new_passcode, 10);

    // Update passcode
    const { error: updateError } = await supabase
      .from('staff')
      .update({
        passcode: hashedPasscode,
        updated_at: new Date().toISOString()
      })
      .eq('id', staff_id);

    if (updateError) throw updateError;

    // Log passcode change
    await supabase
      .from('staff_activity_logs')
      .insert([{
        staff_id,
        company_id,
        store_id,
        action_type: 'passcode_changed',
        action_details: {
          changed_at: new Date().toISOString()
        }
      }]);

    res.json({
      success: true,
      message: 'Passcode changed successfully'
    });

  } catch (error) {
    console.error('Change passcode error:', error);
    res.status(500).json({ error: 'Failed to change passcode' });
  }
}

export {
  getRolePermissions,
  updateStaffRole,
  verifyManagerOverride,
  logActivity,
  getActivityLogs,
  changePasscode
};
