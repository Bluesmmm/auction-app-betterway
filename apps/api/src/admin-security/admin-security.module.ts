import { Module } from "@nestjs/common";
import { AdminSecurityService } from "./admin-security.service.js";

@Module({
  providers: [AdminSecurityService],
  exports: [AdminSecurityService]
})
export class AdminSecurityModule {}
