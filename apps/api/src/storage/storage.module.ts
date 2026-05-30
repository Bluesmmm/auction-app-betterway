import { Module } from "@nestjs/common";
import { AppConfigModule } from "../config/app-config.module.js";
import { AppConfigService } from "../config/app-config.service.js";
import { PrivateObjectStorageService } from "./private-object-storage.service.js";

@Module({
  imports: [AppConfigModule],
  providers: [
    {
      provide: PrivateObjectStorageService,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) =>
        new PrivateObjectStorageService(config.objectStorageSigningKey)
    }
  ],
  exports: [PrivateObjectStorageService]
})
export class StorageModule {}
