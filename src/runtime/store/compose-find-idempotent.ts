import { type Store } from './authority.js';
import { type StoreOwner } from './owner.js';
import { type StoreGlobals } from './globals.js';
import { type StoreOperations } from './operations.js';
import { createFindIdempotent } from './operations/jobs-api-list-known-write-task-summaries.js';
import {
  createCreateJob,
  createRunningJob,
  createStartJob,
  createAssertNotCancelled,
  createRequestCancellation,
} from './operations/jobs-api-create-job.js';

export function composeFindIdempotent(
  owner: StoreOwner,
  store: Store,
  globals: StoreGlobals,
  operations: StoreOperations,
): void {
  operations.findIdempotent = createFindIdempotent({
    get publicReads() {
      return owner.publicReads;
    },
    set publicReads(value) {
      owner.publicReads = value;
    },
    get ensureOpen() {
      return owner.ensureOpen.bind(owner);
    },
    get prepare() {
      return owner.prepare.bind(owner);
    },
    get getJob() {
      return owner.getJob.bind(owner);
    },
  });
  operations.createJob = createCreateJob({
    get publicReads() {
      return owner.publicReads;
    },
    set publicReads(value) {
      owner.publicReads = value;
    },
    get transaction() {
      return owner.transaction.bind(owner);
    },
    get findIdempotent() {
      return owner.findIdempotent.bind(owner);
    },
    get prepare() {
      return owner.prepare.bind(owner);
    },
    get ownerId() {
      return owner.ownerId;
    },
    set ownerId(value) {
      owner.ownerId = value;
    },
    get getJob() {
      return owner.getJob.bind(owner);
    },
    get newGenericJobs() {
      return owner.newGenericJobs;
    },
    set newGenericJobs(value) {
      owner.newGenericJobs = value;
    },
  });
  operations.runningJob = createRunningJob({
    get getJob() {
      return owner.getJob.bind(owner);
    },
    get ownerId() {
      return owner.ownerId;
    },
    set ownerId(value) {
      owner.ownerId = value;
    },
  });
  operations.startJob = createStartJob({
    get publicReads() {
      return owner.publicReads;
    },
    set publicReads(value) {
      owner.publicReads = value;
    },
    get transaction() {
      return owner.transaction.bind(owner);
    },
    get getJob() {
      return owner.getJob.bind(owner);
    },
    get ownerId() {
      return owner.ownerId;
    },
    set ownerId(value) {
      owner.ownerId = value;
    },
    get prepare() {
      return owner.prepare.bind(owner);
    },
  });
  operations.assertNotCancelled = createAssertNotCancelled({});
  operations.requestCancellation = createRequestCancellation({
    get publicReads() {
      return owner.publicReads;
    },
    set publicReads(value) {
      owner.publicReads = value;
    },
    get transaction() {
      return owner.transaction.bind(owner);
    },
    get getJob() {
      return owner.getJob.bind(owner);
    },
    terminal: globals.terminal,
    get ownerId() {
      return owner.ownerId;
    },
    set ownerId(value) {
      owner.ownerId = value;
    },
    get prepare() {
      return owner.prepare.bind(owner);
    },
  });
}
