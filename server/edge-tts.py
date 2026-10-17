"""Read synthesis parameters from stdin; keep user text out of process arguments."""
import asyncio
import json
import sys
import edge_tts

async def main():
    request = json.load(sys.stdin)
    await edge_tts.Communicate(request['text'], request['voice']).save(request['output'])

if __name__ == '__main__':
    asyncio.run(main())
