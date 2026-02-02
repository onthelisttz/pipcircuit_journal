import { TradeDetailView } from "@ui/features/trade-detail";

interface PageProps {
    params: Promise<{ id: string }>;
}

export default async function TradePage({ params }: PageProps) {
    const { id } = await params;

    return (
        <div className="container mx-auto max-w-7xl py-8">
            <TradeDetailView tradeId={Number(id)} />
        </div>
    );
}
