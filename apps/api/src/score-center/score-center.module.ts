import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ScoreCenterController } from './routes';
import { ScoreCenterService } from './service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [ScoreCenterController],
  providers: [ScoreCenterService],
  exports: [ScoreCenterService],
})
export class ScoreCenterModule {}
