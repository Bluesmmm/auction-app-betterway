import { Module } from "@nestjs/common";
import { PrivateObjectStorageService } from "./private-object-storage.service.js";

@Module({
  providers: [PrivateObjectStorageService],
  exports: [PrivateObjectStorageService]
})
export class StorageModule {}
