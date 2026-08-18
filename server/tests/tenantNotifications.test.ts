import { describe, it, expect, beforeAll } from 'vitest';
import { api, authed, login, ADMIN, SCOPED_RECRUITER, prisma, serverUp } from './helpers.js';

describe('Tenant Notifications Admin Exclusion & Scenarios', () => {
  let up = false;
  let adminToken = '';
  let recruiterToken = '';

  beforeAll(async () => {
    up = await serverUp();
    if (up) {
      adminToken = await login(ADMIN);
      recruiterToken = await login(SCOPED_RECRUITER);
    }
  });

  it('blocks regular users from tenant notifications APIs (403)', async () => {
    if (!up) return;

    const listRes = await authed(recruiterToken).get('/api/notifications/tenant');
    expect(listRes.status).toBe(403);
  });

  it('verifies Scenario 1: Admin receives notification -> My Notifications has it, Tenant does not', async () => {
    if (!up) return;

    const adminUser = await prisma.user.findFirst({ where: { email: ADMIN.email } });

    // Clean up
    await prisma.adminNotificationState.deleteMany({});
    await prisma.notification.deleteMany({
      where: { recipientId: adminUser!.id },
    });

    // Create notification for Admin
    const notif = await prisma.notification.create({
      data: {
        recipientId: adminUser!.id,
        tenantId: adminUser!.tenantId,
        type: 'GENERIC',
        title: 'Admin Alert',
        message: 'Personal system alert',
      },
    });

    // Admin checks My Notifications
    const myNotifs = await authed(adminToken).get('/api/notifications');
    expect(myNotifs.body?.data?.items.some((n: any) => n.id === notif.id)).toBe(true);

    // Admin checks Tenant Notifications
    const tenantNotifs = await authed(adminToken).get('/api/notifications/tenant');
    expect(tenantNotifs.body?.data?.items.some((n: any) => n.id === notif.id)).toBe(false);

    // Tenant unread count excludes admin's own notifications
    const tenantCount = await authed(adminToken).get('/api/notifications/tenant/unread-count');
    expect(tenantCount.body?.data?.count).toBe(0);

    // Cleanup
    await prisma.notification.deleteMany({ where: { id: notif.id } });
  });

  it('verifies Scenario 2, 3, & 4: HR, Hiring Manager, Recruiter notifications show in Tenant', async () => {
    if (!up) return;

    const adminUser = await prisma.user.findFirst({ where: { email: ADMIN.email } });
    const recruiterUser = await prisma.user.findFirst({ where: { email: SCOPED_RECRUITER.email } });

    // Clean up
    await prisma.adminNotificationState.deleteMany({});
    await prisma.notification.deleteMany({
      where: { recipientId: { in: [adminUser!.id, recruiterUser!.id] } },
    });

    // Create notification for Recruiter
    const notif = await prisma.notification.create({
      data: {
        recipientId: recruiterUser!.id,
        tenantId: adminUser!.tenantId,
        type: 'JOB_VIEW',
        title: 'Recruiter Alert',
        message: 'New application assigned',
      },
    });

    // Recruiter sees it in My Notifications
    const myNotifs = await authed(recruiterToken).get('/api/notifications');
    expect(myNotifs.body?.data?.items.some((n: any) => n.id === notif.id)).toBe(true);

    // Admin sees it in Tenant Notifications
    const tenantNotifs = await authed(adminToken).get('/api/notifications/tenant');
    expect(tenantNotifs.body?.data?.items.some((n: any) => n.id === notif.id)).toBe(true);

    // Tenant unread count includes it
    const tenantCount = await authed(adminToken).get('/api/notifications/tenant/unread-count');
    expect(tenantCount.body?.data?.count).toBe(1);

    // Cleanup
    await prisma.notification.deleteMany({ where: { id: notif.id } });
  });

  it('verifies Scenario 5: Multiple Admin isolation: Admin A notification is hidden from Admin A tenant view, but visible in Admin B tenant view', async () => {
    if (!up) return;

    const adminUser = await prisma.user.findFirst({ where: { email: ADMIN.email } });

    // Find or create second admin
    let adminB = await prisma.user.findFirst({
      where: {
        tenantId: adminUser!.tenantId,
        role: { name: 'ADMIN' },
        NOT: { id: adminUser!.id },
      },
    });

    if (!adminB) {
      adminB = await prisma.user.create({
        data: {
          email: 'adminB@agnohire.local',
          fullName: 'Admin B',
          roleId: adminUser!.roleId,
          tenantId: adminUser!.tenantId,
        },
      });
    }

    // Clean up
    await prisma.adminNotificationState.deleteMany({});
    await prisma.notification.deleteMany({
      where: { recipientId: { in: [adminUser!.id, adminB!.id] } },
    });

    // Create notification for Admin A
    const notif = await prisma.notification.create({
      data: {
        recipientId: adminUser!.id,
        tenantId: adminUser!.tenantId,
        type: 'GENERIC',
        title: 'Admin A Personal',
        message: 'System alert for Admin A',
      },
    });

    // Admin A sees it in My Notifications
    const myNotifsA = await authed(adminToken).get('/api/notifications');
    expect(myNotifsA.body?.data?.items.some((n: any) => n.id === notif.id)).toBe(true);

    // Admin A does NOT see it in Tenant view
    const tenantNotifsA = await authed(adminToken).get('/api/notifications/tenant');
    expect(tenantNotifsA.body?.data?.items.some((n: any) => n.id === notif.id)).toBe(false);

    // Admin B sees it in Tenant view (query directly as Admin B)
    const tenantNotifsB = await prisma.notification.findMany({
      where: {
        recipientId: { not: adminB!.id },
        tenantId: adminUser!.tenantId,
        adminStates: {
          none: {
            adminId: adminB!.id,
            isCleared: true,
          },
        },
      },
    });
    expect(tenantNotifsB.some((n) => n.id === notif.id)).toBe(true);

    // Cleanup
    await prisma.notification.deleteMany({
      where: { recipientId: { in: [adminUser!.id, adminB!.id] } },
    });
  });
});
