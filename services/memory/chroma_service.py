import os
import chromadb
from chromadb.api import ClientAPI
from chromadb.utils import embedding_functions

# Use a specific embedding model locally
EMBEDDING_MODEL_NAME = "all-MiniLM-L6-v2"
embedding_fn = embedding_functions.SentenceTransformerEmbeddingFunction(model_name=EMBEDDING_MODEL_NAME)

_client_instance = None

def get_chroma_client() -> ClientAPI:
    """Create and return a single persistent ChromaDB client instance."""
    global _client_instance
    if _client_instance is None:
        project_root = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
        db_path = os.path.join(project_root, "chroma_data")
        os.makedirs(db_path, exist_ok=True)
        _client_instance = chromadb.PersistentClient(
            path=db_path,
            settings=chromadb.config.Settings(anonymized_telemetry=False)
        )
    return _client_instance

def get_collection(name: str):
    """Retrieve (or create) a collection by name with the integrated embedding function."""
    client = get_chroma_client()
    return client.get_or_create_collection(
        name=name,
        embedding_function=embedding_fn
    )
