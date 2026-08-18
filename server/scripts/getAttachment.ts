import { PrismaClient } from '@prisma/client';
import fs from 'fs';
const prisma = new PrismaClient();

async function main() {
  const attachment = await prisma.attachment.findFirst({
    where: { fileName: { contains: 'technical' } },
    orderBy: { createdAt: 'desc' }
  });
  
  if (attachment) {
    fs.writeFileSync('../technical_question.pdf', attachment.data);
    console.log('Saved to ../technical_question.pdf');
  } else {
    console.log('Attachment not found');
  }
}
main().catch(console.error).finally(() => prisma.$disconnect());
