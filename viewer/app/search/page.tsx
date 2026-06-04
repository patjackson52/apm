"use client";
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { SearchResults } from '@/components/search/SearchResults';

function SearchInner() {
  const q = useSearchParams().get('q') ?? '';
  return (
    <>
      <h1>Search</h1>
      <SearchResults q={q} />
    </>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<h1>Search</h1>}>
      <SearchInner />
    </Suspense>
  );
}
