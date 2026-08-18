import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const msgs = await prisma.chatMessage.findMany({
    orderBy: { createdAt: "desc" },
    take: 10
  });
  console.log(JSON.stringify(msgs, null, 2));
}
main().catch(console.error).finally(() => prisma.$disconnect());
