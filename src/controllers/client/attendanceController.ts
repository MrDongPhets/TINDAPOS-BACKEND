import { Request, Response } from 'express';
import { getDb } from '../../config/database';

// ─── Staff: Clock In ────────────────────────────────────────────────────────

async function clockIn(req: Request, res: Response): Promise<void> {
  try {
    const staffId = req.user!.id;
    const companyId = req.user!.company_id!;
    const storeId = req.user!.store_id!;
    const { notes, verified_with_biometric = false } = req.body;

    const supabase = getDb();

    // Prevent duplicate open shifts
    const { data: openRows } = await supabase
      .from('staff_attendance')
      .select('id, clock_in')
      .eq('staff_id', staffId)
      .is('clock_out', null)
      .order('clock_in', { ascending: false })
      .limit(1);

    const open = openRows?.[0] ?? null;
    if (open) {
      res.status(409).json({ error: 'Already clocked in', clock_in: open.clock_in });
      return;
    }

    const { data, error } = await supabase
      .from('staff_attendance')
      .insert({
        staff_id: staffId,
        company_id: companyId,
        store_id: storeId,
        notes: notes || null,
        verified_with_biometric,
      })
      .select()
      .single();

    if (error) throw error;

    console.log(`✅ Staff ${staffId} clocked in`);
    res.json({ attendance: data });
  } catch (error) {
    console.error('❌ clockIn error:', error);
    res.status(500).json({ error: 'Failed to clock in' });
  }
}

// ─── Staff: Clock Out ───────────────────────────────────────────────────────

async function clockOut(req: Request, res: Response): Promise<void> {
  try {
    const staffId = req.user!.id;
    const { notes, verified_with_biometric = false } = req.body;

    const supabase = getDb();

    const { data: openRows, error: findError } = await supabase
      .from('staff_attendance')
      .select('id, clock_in')
      .eq('staff_id', staffId)
      .is('clock_out', null)
      .order('clock_in', { ascending: false })
      .limit(1);

    if (findError) throw findError;
    const open = openRows?.[0] ?? null;
    if (!open) {
      res.status(404).json({ error: 'No active shift found' });
      return;
    }

    const now = new Date();
    const clockInTime = new Date(open.clock_in);
    const totalMinutes = Math.round((now.getTime() - clockInTime.getTime()) / 60000);

    const { data, error } = await supabase
      .from('staff_attendance')
      .update({
        clock_out: now.toISOString(),
        total_minutes: totalMinutes,
        notes: notes || null,
        verified_with_biometric,
        updated_at: now.toISOString(),
      })
      .eq('id', open.id)
      .select()
      .single();

    if (error) throw error;

    console.log(`✅ Staff ${staffId} clocked out — ${totalMinutes} minutes`);
    res.json({ attendance: data });
  } catch (error) {
    console.error('❌ clockOut error:', error);
    res.status(500).json({ error: 'Failed to clock out' });
  }
}

// ─── Staff: Active Shift Status ─────────────────────────────────────────────

async function getAttendanceStatus(req: Request, res: Response): Promise<void> {
  try {
    const staffId = req.user!.id;
    const supabase = getDb();

    const { data: rows, error } = await supabase
      .from('staff_attendance')
      .select('id, clock_in, notes, verified_with_biometric')
      .eq('staff_id', staffId)
      .is('clock_out', null)
      .order('clock_in', { ascending: false })
      .limit(1);

    if (error) throw error;

    const activeShift = rows?.[0] ?? null;
    res.set('Cache-Control', 'no-store');
    res.json({ clocked_in: !!activeShift, active_shift: activeShift });
  } catch (error) {
    console.error('❌ getAttendanceStatus error:', error);
    res.status(500).json({ error: 'Failed to get attendance status' });
  }
}

// ─── Staff: Own Attendance History ──────────────────────────────────────────

async function getMyAttendance(req: Request, res: Response): Promise<void> {
  try {
    const staffId = req.user!.id;
    const { limit = '30', offset = '0' } = req.query as Record<string, string>;
    const supabase = getDb();

    const { data, error, count } = await supabase
      .from('staff_attendance')
      .select('*', { count: 'exact' })
      .eq('staff_id', staffId)
      .order('clock_in', { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    if (error) throw error;

    res.set('Cache-Control', 'no-store');
    res.json({ attendance: data, total: count });
  } catch (error) {
    console.error('❌ getMyAttendance error:', error);
    res.status(500).json({ error: 'Failed to fetch attendance' });
  }
}

// ─── Client: All Staff Attendance ───────────────────────────────────────────

async function getAllAttendance(req: Request, res: Response): Promise<void> {
  try {
    const companyId = req.user!.company_id!;
    const {
      staff_id,
      store_id,
      date_from,
      date_to,
      limit = '50',
      offset = '0',
    } = req.query as Record<string, string>;

    const supabase = getDb();

    let query = supabase
      .from('staff_attendance')
      .select(
        `*, staff:staff_id ( id, name, staff_id, role, store_id )`,
        { count: 'exact' }
      )
      .eq('company_id', companyId)
      .order('clock_in', { ascending: false });

    if (staff_id) query = query.eq('staff_id', staff_id);
    if (store_id) query = query.eq('store_id', store_id);
    if (date_from) query = query.gte('clock_in', date_from);
    if (date_to) query = query.lte('clock_in', date_to);

    query = query.range(Number(offset), Number(offset) + Number(limit) - 1);

    const { data, error, count } = await query;
    if (error) throw error;

    res.set('Cache-Control', 'no-store');
    console.log(`✅ Fetched ${data?.length} attendance records for company ${companyId}`);
    res.json({ attendance: data, total: count });
  } catch (error) {
    console.error('❌ getAllAttendance error:', error);
    res.status(500).json({ error: 'Failed to fetch attendance records' });
  }
}

// ─── Client: Attendance Summary (hours per staff) ───────────────────────────

async function getAttendanceSummary(req: Request, res: Response): Promise<void> {
  try {
    const companyId = req.user!.company_id!;
    const { date_from, date_to, store_id } = req.query as Record<string, string>;
    const supabase = getDb();

    let query = supabase
      .from('staff_attendance')
      .select(`staff_id, total_minutes, staff:staff_id ( name, staff_id, role )`)
      .eq('company_id', companyId)
      .not('clock_out', 'is', null);

    if (store_id) query = query.eq('store_id', store_id);
    if (date_from) query = query.gte('clock_in', date_from);
    if (date_to) query = query.lte('clock_in', date_to);

    const { data, error } = await query;
    if (error) throw error;

    // Aggregate total minutes per staff
    const summaryMap: Record<string, { staff: any; total_minutes: number; shift_count: number }> = {};
    for (const row of data || []) {
      const sid = row.staff_id as string;
      if (!summaryMap[sid]) {
        summaryMap[sid] = { staff: row.staff, total_minutes: 0, shift_count: 0 };
      }
      summaryMap[sid].total_minutes += row.total_minutes || 0;
      summaryMap[sid].shift_count += 1;
    }

    const summary = Object.values(summaryMap).sort((a, b) => b.total_minutes - a.total_minutes);

    res.json({ summary });
  } catch (error) {
    console.error('❌ getAttendanceSummary error:', error);
    res.status(500).json({ error: 'Failed to fetch attendance summary' });
  }
}

export {
  clockIn,
  clockOut,
  getAttendanceStatus,
  getMyAttendance,
  getAllAttendance,
  getAttendanceSummary,
};
