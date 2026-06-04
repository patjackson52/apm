"use client";
import { useStatus } from '@/lib/api/hooks';
import { Skeleton } from '@/components/Skeleton';
import { StatusCounts } from '@/components/dashboard/StatusCounts';
import { AwaitingHuman } from '@/components/dashboard/AwaitingHuman';
import { ActiveRuns } from '@/components/dashboard/ActiveRuns';
import { ActiveLeases } from '@/components/dashboard/ActiveLeases';
import { ActivityFeed } from '@/components/dashboard/ActivityFeed';
import s from '@/components/dashboard/dashboard.module.css';

export default function Page() {
  const { data, isLoading, isError } = useStatus();
  return (
    <>
      <h1>Dashboard</h1>
      {isLoading ? (
        <Skeleton count={4} h={60} />
      ) : isError || !data ? (
        <p>Failed to load status.</p>
      ) : (
        <div className={s.grid}>
          <StatusCounts status={data} />
          <AwaitingHuman items={data.awaiting_human} />
          <ActiveRuns runs={data.active_runs} />
          <ActiveLeases leases={data.active_leases} />
        </div>
      )}
      <ActivityFeed />
    </>
  );
}
