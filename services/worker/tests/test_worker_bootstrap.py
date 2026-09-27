def test_worker_package_is_importable() -> None:
    import forgeflow_worker

    assert forgeflow_worker.__doc__
