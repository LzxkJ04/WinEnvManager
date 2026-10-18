# -*- coding: utf-8 -*-
"""托盘深浅图标已并入 make_icon.py，这里保留原入口。"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import make_icon  # noqa: E402


if __name__ == '__main__':
    make_icon.main()
