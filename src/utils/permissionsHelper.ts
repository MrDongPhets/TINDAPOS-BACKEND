// src/utils/permissionsHelper.ts
// Helper functions for permission checking

const ROLE_HIERARCHY: Record<string, number> = {
  manager: 3,
  supervisor: 2,
  staff: 1
};

const PERMISSION_REQUIREMENTS: Record<string, number> = {
  // POS Operations
  process_sale: 1,              // staff and above
  open_cash_drawer: 1,          // staff and above
  view_products: 1,             // staff and above
  search_products: 1,           // staff and above
  scan_barcode: 1,              // staff and above
  print_receipt: 1,             // staff and above

  // Restricted POS Operations
  void_transaction: 2,          // supervisor and above
  apply_discount: 2,            // supervisor and above
  process_refund: 3,            // manager only
  price_override: 3,            // manager only

  // Reports & Analytics
  view_reports: 2,              // supervisor and above
  view_staff_performance: 2,    // supervisor and above
  export_reports: 3,            // manager only

  // Inventory Management
  view_inventory: 1,            // staff and above
  adjust_inventory: 3,          // manager only
  manage_products: 3,           // manager only

  // Staff Management
  view_staff: 2,                // supervisor and above
  manage_staff: 3,              // manager only

  // End of Day
  end_of_day: 2                 // supervisor and above
};

/**
 * Check if a role has permission for an action
 * @param role - The role to check (staff, supervisor, manager)
 * @param action - The action to check permission for
 * @returns True if role has permission
 */
function hasPermission(role: string, action: string): boolean {
  const roleLevel = ROLE_HIERARCHY[role] || 0;
  const requiredLevel = PERMISSION_REQUIREMENTS[action] || 3;

  return roleLevel >= requiredLevel;
}

/**
 * Get all permissions for a role
 * @param role - The role to get permissions for
 * @returns Object with all permissions and their boolean values
 */
function getRolePermissions(role: string): Record<string, boolean> {
  const roleLevel = ROLE_HIERARCHY[role] || 0;
  const permissions: Record<string, boolean> = {};

  for (const [action, requiredLevel] of Object.entries(PERMISSION_REQUIREMENTS)) {
    permissions[action] = roleLevel >= requiredLevel;
  }

  return permissions;
}

/**
 * Check if an action requires manager override
 * @param userRole - Current user's role
 * @param action - Action being attempted
 * @returns True if manager override is needed
 */
function requiresManagerOverride(userRole: string, action: string): boolean {
  return !hasPermission(userRole, action);
}

/**
 * Get minimum role required for an action
 * @param action - The action to check
 * @returns Minimum role required (staff, supervisor, manager)
 */
function getMinimumRole(action: string): string {
  const requiredLevel = PERMISSION_REQUIREMENTS[action] || 3;

  for (const [role, level] of Object.entries(ROLE_HIERARCHY)) {
    if (level >= requiredLevel) {
      return role;
    }
  }

  return 'manager';
}

/**
 * Check if a role can authorize an override for another role
 * @param authorizingRole - Role of person authorizing
 * @param action - Action being authorized
 * @returns True if can authorize
 */
function canAuthorizeOverride(authorizingRole: string, action: string): boolean {
  return hasPermission(authorizingRole, action);
}

export {
  ROLE_HIERARCHY,
  PERMISSION_REQUIREMENTS,
  hasPermission,
  getRolePermissions,
  requiresManagerOverride,
  getMinimumRole,
  canAuthorizeOverride
};
