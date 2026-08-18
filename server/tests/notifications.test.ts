import { describe, it, expect, beforeAll } from 'vitest';
import { api, authed, login, ADMIN, SCOPED_RECRUITER, prisma, serverUp } from './helpers.js';

/**
 * In-app notification center: endpoints respond with the right shapes, auth is
 * enforced, and a real notification is delivered + clearable. The delivery test
 * adds the QA recruiter as a panelist (then removes them) and self-skips if the
 * recruiter fixture isn't present.
 */
describe('Notifications', () => {
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

  it('requires auth', async () => {
    if (!up) return;
    const res = await api().get('/api/notifications');
    expect(res.status).toBe(401);
  });

  it('returns a paginated list and an unread count', async () => {
    if (!up) return;
    const list = await authed(adminToken).get('/api/notifications?limit=5');
    expect(list.status).toBe(200);
    expect(list.body?.data).toHaveProperty('items');
    expect(list.body?.data).toHaveProperty('meta');

    const count = await authed(adminToken).get('/api/notifications/unread-count');
    expect(count.status).toBe(200);
    expect(typeof count.body?.data?.count).toBe('number');
  });

  it('clears notifications for the authenticated user only', async () => {
    if (!up) return;

    // Resolve user IDs using superuser prisma client
    const adminUser = await prisma.user.findFirst({ where: { email: ADMIN.email } });
    const recruiterUser = await prisma.user.findFirst({ where: { email: SCOPED_RECRUITER.email } });

    expect(adminUser).toBeDefined();
    expect(recruiterUser).toBeDefined();

    // Clean up any existing notifications for these users first
    await prisma.notification.deleteMany({
      where: { recipientId: { in: [adminUser!.id, recruiterUser!.id] } },
    });

    // Create a notification for Admin user
    await prisma.notification.create({
      data: {
        recipientId: adminUser!.id,
        tenantId: adminUser!.tenantId,
        type: 'TEST_ADMIN',
        title: 'Admin Alert',
        message: 'Hello Admin',
      },
    });

    // Create a notification for Recruiter user
    await prisma.notification.create({
      data: {
        recipientId: recruiterUser!.id,
        tenantId: recruiterUser!.tenantId,
        type: 'TEST_RECRUITER',
        title: 'Recruiter Alert',
        message: 'Hello Recruiter',
      },
    });

    // Verify Admin sees their notification
    const adminCountBefore = await authed(adminToken).get('/api/notifications/unread-count');
    expect(adminCountBefore.body?.data?.count).toBe(1);

    // Verify Recruiter sees their notification
    const recruiterCountBefore = await authed(recruiterToken).get('/api/notifications/unread-count');
    expect(recruiterCountBefore.body?.data?.count).toBe(1);

    // Admin clears their notifications
    const clearRes = await authed(adminToken).delete('/api/notifications/clear-all');
    expect(clearRes.status).toBe(200);

    // Verify Admin's notifications are hard-deleted
    const adminCountAfter = await authed(adminToken).get('/api/notifications/unread-count');
    expect(adminCountAfter.body?.data?.count).toBe(0);

    const dbAdminNotifs = await prisma.notification.findMany({
      where: { recipientId: adminUser!.id },
    });
    expect(dbAdminNotifs.length).toBe(0);

    // Verify Recruiter's notification is still intact
    const recruiterCountAfter = await authed(recruiterToken).get('/api/notifications/unread-count');
    expect(recruiterCountAfter.body?.data?.count).toBe(1);

    const dbRecruiterNotifs = await prisma.notification.findMany({
      where: { recipientId: recruiterUser!.id },
    });
    expect(dbRecruiterNotifs.length).toBe(1);

    // Clean up recruiter notification
    await prisma.notification.deleteMany({
      where: { recipientId: recruiterUser!.id },
    });
  });

  it('can clear notifications when count is already 0 without error', async () => {
    if (!up) return;
    
    const adminUser = await prisma.user.findFirst({ where: { email: ADMIN.email } });
    await prisma.notification.deleteMany({
      where: { recipientId: adminUser!.id },
    });

    const clearRes = await authed(adminToken).delete('/api/notifications/clear-all');
    expect(clearRes.status).toBe(200);
    expect(clearRes.body?.data?.cleared).toBe(0);
  });
});

