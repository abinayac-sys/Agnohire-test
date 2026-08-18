import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const history = await prisma.aiChatHistory.findFirst({
    orderBy: { createdAt: 'desc' }
  });
  
  if (history) {
    console.log('Latest Chat History:');
    console.log(JSON.stringify(history.messages, null, 2));
  } else {
    console.log('No chat history found');
  }
}
main().catch(console.error).finally(() => prisma.$disconnect());
