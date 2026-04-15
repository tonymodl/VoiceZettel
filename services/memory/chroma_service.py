import chromadb
from chromadb.config import Settings
from chromadb.api import Client

# Initialize ChromaDB client with persistent storage

def get_chroma_client() -> Client:
    """Create and return a ChromaDB client instance.
    The client stores data in the local 'chroma' directory within the project.
    """
    return chromadb.Client(settings=Settings(
        chroma_db_impl="duckdb+parquet",
        persist_directory="./chroma",
        anonymized_telemetry=False,
    ))

def get_collection(name: str):
    """Retrieve (or create) a collection by name.
    Collections are used to store vector embeddings for RAG.
    """
    client = get_chroma_client()
    if name in client.list_collections():
        return client.get_collection(name)
    return client.create_collection(name)
