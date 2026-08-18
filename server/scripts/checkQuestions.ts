import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const questions = await prisma.question.findMany({
    where: { bank: { name: 'technical question' } }
  });
  
  if (questions.length) {
    console.log('AI Generated counts:');
    const aiTrue = questions.filter(q => q.aiGenerated).length;
    const aiFalse = questions.filter(q => !q.aiGenerated).length;
    console.log('aiGenerated = true:', aiTrue);
    console.log('aiGenerated = false:', aiFalse);
  }
}
main().catch(console.error).finally(() => prisma.$disconnect());
